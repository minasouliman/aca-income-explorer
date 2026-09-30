import unittest
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('cms', Path(__file__).with_name('cms-data.py'))
cms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cms)


def plan(pid, tier='Standard Silver On Exchange Plan', area='TXS001', amount='$1,000', integrated='Yes'):
    r = {'BusinessYear': '2026', 'StateCode': 'TX', 'IssuerId': '12345', 'ServiceAreaId': area,
         'PlanId': pid, 'MetalLevel': 'Silver', 'MarketCoverage': 'Individual', 'DentalOnlyPlan': 'No',
         'CSRVariationType': tier, 'ChildOnlyOffering': 'Allows Adult and Child-Only',
         'MedicalDrugDeductiblesIntegrated': integrated, 'MedicalDrugMaximumOutofPocketIntegrated': 'Yes'}
    for prefix in ['TEHB', 'MEHB', 'DEHB']:
        for suffix in cms.SUFFIXES:
            r[f'{prefix}InnTier1{suffix}MOOP'] = '$8,000' if prefix == 'TEHB' else ''
            r[f'{prefix}DedInnTier1{suffix}'] = amount if (prefix == 'TEHB') == (integrated == 'Yes') else ''
    return r


def area(code='TXS001', county='48201', partial='No', zips='', entire='No'):
    return {'BusinessYear': '2026', 'StateCode': 'TX', 'IssuerId': '12345', 'ServiceAreaId': code,
            'MarketCoverage': 'Individual', 'DentalOnlyPlan': 'No', 'CoverEntireState': entire,
            'County': county, 'PartialCounty': partial, 'ZipCodes': zips}


COUNTIES = [{'STATE': 'TX', 'STATEFP': '48', 'COUNTYFP': '201', 'COUNTYNAME': 'Harris County'},
            {'STATE': 'TX', 'STATEFP': '48', 'COUNTYFP': '157', 'COUNTYNAME': 'Fort Bend County'}]
ZIPS = {'77007': [0, 0, 0, 0, 'tx', 'harris'], '77008': [0, 0, 0, 0, 'tx', 'harris'],
        '77401': {'harris': [0, 0, 0, 0, 'tx', 'harris'], 'fort bend': [0, 0, 0, 0, 'tx', 'fort bend']}}


class CMSTests(unittest.TestCase):
    def test_amounts_and_missing(self):
        self.assertEqual(cms.dollars('$4,500 '), 4500)
        self.assertEqual(cms.dollars('$9000 per group'), 9000)
        self.assertEqual(cms.dollars('$0'), 0)
        self.assertIsNone(cms.dollars('per person not applicable'))
        self.assertIsNone(cms.dollars(''))
        with self.assertRaises(ValueError): cms.dollars('$1,000 or $2,000')
        self.assertEqual(cms.stats([None, 0, 100, 200, 1000]), [4, 0, 150, 325, 1000])
        self.assertEqual(cms.stats([None]), [0, None, None, None, None])

    def test_geography_tiers_dedup_and_separate(self):
        plans = [plan('A'), plan('A'), plan('B', area='TXS002', amount='$0'),
                 plan('C', area='TXS003', amount='$3,000', integrated='No'),
                 plan('D', tier='94% AV Level Silver Plan', amount='$100'),
                 plan('OFF', tier='Standard Silver Off Exchange Plan', amount='$9999')]
        areas = [area(), area(), area('TXS002', partial='Yes', zips='77007, 77401'),
                 area('TXS003', entire='Yes')]
        data = cms.aggregate(plans, areas, COUNTIES, ZIPS)
        def profile(zipcode, county):
            return next(data['profiles'][p] for st, c, f, p, zs in data['locations'] if c == county and zipcode in zs.split())
        h = profile('77007', 'harris')
        self.assertEqual(h['70']['plans'], 3)
        self.assertEqual(h['70']['stats'][0], [3, 0, 1000, 1333.33, 3000])
        self.assertEqual(h['94']['stats'][0], [1, 100, 100, 100, 100])
        self.assertEqual(h['73']['stats'][0], [0, None, None, None, None])
        self.assertEqual(h['70']['stats'][3][0], 2)
        self.assertEqual(h['70']['stats'][9], [1, 3000, 3000, 3000, 3000])
        self.assertEqual(profile('77008', 'harris')['70']['plans'], 2)
        self.assertEqual(profile('77401', 'fort bend')['70']['plans'], 1)
        union = next(data['profiles'][p] for p, zs in data['zipUnions'] if '77401' in zs.split())
        self.assertEqual(union['70']['plans'], 3)

    def test_oop_uses_its_own_integration_flag_and_preserves_scopes(self):
        a, b, c = plan('A'), plan('B', integrated='No'), plan('C')
        a['TEHBInnTier1FamilyPerGroupMOOP'] = '$6,000 per group'
        b['TEHBInnTier1FamilyPerGroupMOOP'] = '$10,000 per group'
        c['TEHBInnTier1FamilyPerGroupMOOP'] = ''
        a['TEHBInnTier1FamilyPerPersonMOOP'] = '$0 per person'
        data = cms.aggregate([a, b, c], [area()], COUNTIES, ZIPS)
        profile = data['profiles'][0]['70']
        metric = lambda name: profile['stats'][data['metrics'].index(name)]
        self.assertEqual(metric('oop.familyPerGroup'), [2, 6000, 8000, 8000, 10000])
        self.assertEqual(metric('oop.individual'), [3, 8000, 8000, 8000, 8000])
        self.assertEqual(metric('oop.familyPerPerson'), [3, 0, 8000, 5333.33, 8000])
        b['MedicalDrugMaximumOutofPocketIntegrated'] = 'No'
        with self.assertRaisesRegex(ValueError, 'Separate medical/drug OOP'):
            cms.aggregate([b], [area()], COUNTIES, ZIPS)

    def test_unknown_geography_and_conflicting_plans_fail(self):
        with self.assertRaisesRegex(ValueError, 'Unmatched'):
            cms.aggregate([plan('A')], [area()], COUNTIES, {'77007': [0,0,0,0,'tx','unknown']})
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            cms.aggregate([plan('A'), plan('A', amount='$2')], [area()], COUNTIES, ZIPS)
        with self.assertRaisesRegex(ValueError, 'missing service'):
            cms.aggregate([plan('A')], [], COUNTIES, ZIPS)


if __name__ == '__main__': unittest.main()
