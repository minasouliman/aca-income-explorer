#!/usr/bin/env python3
"""Build compact 2026 Silver deductible and OOP statistics using only Python's standard library."""
import argparse
import collections
import csv
import datetime
import hashlib
import io
import json
import re
import statistics
import urllib.request
import zipfile
from pathlib import Path

YEAR = 2026
SOURCES = {
    'plan-attributes-puf.zip': 'https://download.cms.gov/marketplace-puf/2026/plan-attributes-puf.zip',
    'service-area-puf.zip': 'https://download.cms.gov/marketplace-puf/2026/service-area-puf.zip',
    'counties.txt': 'https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt',
}
TIERS = {'Standard Silver On Exchange Plan': '70', '73% AV Level Silver Plan': '73',
         '87% AV Level Silver Plan': '87', '94% AV Level Silver Plan': '94'}
SCOPES = ['individual', 'familyPerPerson', 'familyPerGroup']
SUFFIXES = ['Individual', 'FamilyPerPerson', 'FamilyPerGroup']
METRICS = [f'{kind}.{scope}' for kind in ['medical', 'integrated', 'separateMedical', 'separateDrug'] for scope in SCOPES] + [f'oop.{scope}' for scope in SCOPES]


def county_name(value):
    value = re.sub(r' (city and borough|county|parish|borough|census area|municipality)$', '', value.lower())
    return re.sub('[^a-z0-9]', '', value)


def dollars(value):
    value = value.strip()
    if not value or 'not applicable' in value.lower():
        return None
    match = re.fullmatch(r'\$?([\d,]+(?:\.\d+)?)\s*(?:per (?:person|group))?', value)
    if not match:
        raise ValueError(f'Unrecognized cost-sharing amount: {value!r}')
    return float(match[1].replace(',', ''))


def stats(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return [0, None, None, None, None]
    return [len(values), values[0], statistics.median(values), round(statistics.mean(values), 2), values[-1]]


def area_key(row):
    return row['StateCode'], row['IssuerId'], row['ServiceAreaId']


def medical_plan(row):
    return row['BusinessYear'] == str(YEAR) and row['MarketCoverage'] == 'Individual' and row['DentalOnlyPlan'] == 'No'


def read_zip_csv(file):
    with zipfile.ZipFile(file) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith('.csv')]
        if len(names) != 1:
            raise ValueError(f'Expected one CSV in {file}')
        with archive.open(names[0]) as data:
            yield from csv.DictReader(io.TextIOWrapper(data, encoding='utf-8-sig'))


def aggregate(plan_rows, area_rows, county_rows, zips):
    plans = {}
    for row in plan_rows:
        if not medical_plan(row) or row['MetalLevel'] != 'Silver' or row['CSRVariationType'] not in TIERS:
            continue
        if row['ChildOnlyOffering'] != 'Allows Adult and Child-Only':
            raise ValueError('New adult/child plan restrictions require review')
        integrated = row['MedicalDrugDeductiblesIntegrated']
        if integrated not in ('Yes', 'No'):
            raise ValueError('Unrecognized integrated-deductible flag')
        values = {}
        for kind, prefix in [('integrated', 'TEHB'), ('separateMedical', 'MEHB'), ('separateDrug', 'DEHB')]:
            for scope, suffix in zip(SCOPES, SUFFIXES):
                applicable = (kind == 'integrated') == (integrated == 'Yes')
                values[f'{kind}.{scope}'] = dollars(row[f'{prefix}DedInnTier1{suffix}']) if applicable else None
        for scope in SCOPES:
            values[f'medical.{scope}'] = values[f'{"integrated" if integrated == "Yes" else "separateMedical"}.{scope}']
        if row['MedicalDrugMaximumOutofPocketIntegrated'] != 'Yes':
            raise ValueError('Separate medical/drug OOP limits require review before aggregation')
        for scope, suffix in zip(SCOPES, SUFFIXES):
            values[f'oop.{scope}'] = dollars(row[f'TEHBInnTier1{suffix}MOOP'])
        plan = {'tier': TIERS[row['CSRVariationType']], 'area': area_key(row),
                'integrated': integrated == 'Yes', 'values': [values[m] for m in METRICS]}
        if row['PlanId'] in plans and plans[row['PlanId']] != plan:
            raise ValueError(f'Conflicting duplicate PlanId: {row["PlanId"]}')
        plans[row['PlanId']] = plan
    if not plans:
        raise ValueError('No eligible Silver plans')
    states = {p['area'][0] for p in plans.values()}
    areas = collections.defaultdict(list)
    for row in area_rows:
        if medical_plan(row):
            if row['CoverEntireState'] not in ('Yes', 'No') or (row['CoverEntireState'] == 'No' and row['PartialCounty'] not in ('Yes', 'No')):
                raise ValueError('Unrecognized service-area flags')
            if row['CoverEntireState'] == 'No' and not re.fullmatch(r'\d{5}', row['County']):
                raise ValueError('Invalid county FIPS')
            if row['PartialCounty'] == 'Yes' and not all(re.fullmatch(r'\d{5}', z.strip()) for z in row['ZipCodes'].split(',')):
                raise ValueError('Invalid partial-county ZIP list')
            areas[area_key(row)].append(row)
    missing = {p['area'] for p in plans.values()} - areas.keys()
    if missing:
        raise ValueError(f'Plans reference missing service areas: {sorted(missing)[:5]}')
    counties = collections.defaultdict(set)
    for row in county_rows:
        counties[row['STATE'], county_name(row['COUNTYNAME'])].add(row['STATEFP'] + row['COUNTYFP'])
    state_areas = collections.defaultdict(set)
    county_areas = collections.defaultdict(set)
    partial_areas = collections.defaultdict(set)
    by_area = collections.defaultdict(set)
    for pid, plan in plans.items():
        by_area[plan['area']].add(pid)
    for key in by_area:
        for area in areas[key]:
            if area['CoverEntireState'] == 'Yes':
                state_areas[key[0]].add(key)
            elif area['PartialCounty'] == 'No':
                county_areas[key[0], area['County']].add(key)
            else:
                for zipcode in area['ZipCodes'].replace(' ', '').split(','):
                    partial_areas[key[0], area['County'], zipcode].add(key)
    # ZIPs sharing a county and the same partial-area memberships share a plan set.
    membership_cache = {}
    profile_cache = {}
    profiles = []
    profile_dedup = {}
    location_groups = collections.defaultdict(list)
    zip_groups = collections.defaultdict(list)
    unmatched = set()
    empty_locations = []
    supported_zips = 0
    county_locations = 0

    def profile_for(ids):
        key = tuple(sorted(ids))
        if not key:
            return None
        if key not in profile_cache:
            profile = {}
            for tier in TIERS.values():
                selected = [plans[pid] for pid in key if plans[pid]['tier'] == tier]
                profile[tier] = {'plans': len(selected), 'integratedPlans': sum(p['integrated'] for p in selected),
                                 'stats': [stats([p['values'][i] for p in selected]) for i in range(len(METRICS))]}
            signature = json.dumps(profile, sort_keys=True)
            if signature not in profile_dedup:
                profile_dedup[signature] = len(profiles)
                profiles.append(profile)
            profile_cache[key] = profile_dedup[signature]
        return profile_cache[key]

    for zipcode, entry in sorted(zips.items()):
        if not re.fullmatch(r'\d{5}', zipcode):
            continue
        combined = set()
        records = [entry] if isinstance(entry, list) else entry.values()
        for record in records:
            state, county = record[4].upper(), record[5]
            if state not in states:
                continue
            matches = counties[state, county_name(county)]
            if len(matches) != 1:
                unmatched.add((state, county))
                continue
            fips = next(iter(matches))
            keys = tuple(sorted(state_areas[state] | county_areas[state, fips] | partial_areas[state, fips, zipcode]))
            if keys not in membership_cache:
                membership_cache[keys] = set().union(*(by_area[key] for key in keys)) if keys else set()
            ids = membership_cache[keys]
            profile = profile_for(ids)
            if profile is None:
                empty_locations.append([zipcode, state, county])
                continue
            combined.update(ids)
            location_groups[state.lower(), county, fips, profile].append(zipcode)
            county_locations += 1
        profile = profile_for(combined)
        if profile is not None:
            zip_groups[profile].append(zipcode)
            supported_zips += 1
    if unmatched:
        raise ValueError(f'Unmatched/ambiguous county names in covered states: {sorted(unmatched)}')
    return {
        'schemaVersion': 2, 'year': YEAR, 'metrics': METRICS, 'statFields': ['count', 'min', 'median', 'avg', 'max'],
        'profiles': profiles,
        'locations': [[*key, ' '.join(value)] for key, value in sorted(location_groups.items())],
        'zipUnions': [[key, ' '.join(value)] for key, value in sorted(zip_groups.items())],
        'coverage': {'states': sorted(states), 'zipCount': supported_zips, 'countyLocations': county_locations,
                     'planVariants': len(plans), 'standardPlans': sum(p['tier'] == '70' for p in plans.values()),
                     'unmatchedCounties': sorted(unmatched), 'locationsWithoutPlans': empty_locations},
    }


def download(url, destination):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as response, destination.open('wb') as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
            return
        except Exception:
            if attempt == 2:
                raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zips', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--raw-dir', type=Path, required=True)
    parser.add_argument('--cached', action='store_true', help='Reprocess already downloaded files; no downloads')
    args = parser.parse_args()
    args.raw_dir.mkdir(parents=True, exist_ok=True)
    sources = []
    for filename, url in SOURCES.items():
        destination = args.raw_dir / filename
        if not args.cached:
            print(f'Downloading {url}', flush=True)
            download(url, destination)
        sources.append({'file': filename, 'url': url, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'bytes': destination.stat().st_size})
    with (args.raw_dir / 'counties.txt').open(encoding='utf-8-sig') as f:
        counties = list(csv.DictReader(f, delimiter='|'))
    data = aggregate(read_zip_csv(args.raw_dir / 'plan-attributes-puf.zip'),
                     read_zip_csv(args.raw_dir / 'service-area-puf.zip'), counties, json.loads(args.zips.read_text()))
    data['provenance'] = {'processedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                          'downloadedThisRun': not args.cached, 'sources': sources,
                          'zipGeography': 'KFF 2026 ZIP-to-county records joined to Census 2020 county FIPS',
                          'zipGeographySha256': hashlib.sha256(args.zips.read_bytes()).hexdigest(),
                          'method': 'Unweighted statistics over unique 2026 individual-market on-exchange Silver PlanIds; each CSR tier separate; in-network tier 1 only. Missing values excluded, zero retained. Medical uses combined medical/drug deductible when integrated, medical-only otherwise. OOP uses combined medical/drug in-network tier 1 MOOP fields, independently of deductible integration; separate OOP structures require review. ZIP unions count each plan once across counties; county results use the selected county.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, separators=(',', ':')) + '\n')
    print(f'CMS: {data["coverage"]["zipCount"]:,} ZIPs, {len(data["coverage"]["states"])} states, {len(data["profiles"]):,} shared profiles; {args.output.stat().st_size:,} bytes.', flush=True)


if __name__ == '__main__':
    main()
