# ACA Income Explorer

A standalone, offline-capable HTML calculator for 2026 KFF Marketplace estimates.

Open `dist/index.html` directly in a browser. All styling, calculation code, and 40,561 KFF ZIP records and CMS deductible and OOP aggregates for 22,268 ZIPs are embedded in that file. No server, build dependencies, account, or network connection is required to use the downloaded page. This project is local-only. Open the HTML directly; no deployment is needed.

Defaults: ZIP 77007; two adults aged 35 and 40; one child aged 10; no tobacco use; enrollment determined automatically at each income; income 100–500% FPL in fixed $1,000 steps from the lower bound, plus the exact endpoint ($26,650–$133,250 for this household). The income bounds and increment are automatic and have no input controls. Child age is an editable assumption. Plots update automatically as valid household inputs change; incomplete or invalid edits retain the last valid plots with an inline message. Hover/tap plots or use the keyboard-accessible income slider. The monthly/annual selector is in the input panel; display units and series visibility update immediately.

## Rebuild and check

Run from this directory with Node 18 or later:

```sh
node build.mjs
npm test
```

The source is in `src/`. The build deduplicates `data/zips.json` into shared records and grouped ZIP references, then embeds that compact lookup with `data/rules.json` and `data/provenance.json`. Raw source data remains unchanged for verification. No package installation is required. `dist/index.html` is the complete distributable.

## Data and interpretation

KFF source and data were retrieved September 28, 2026. The original script is linked in the page. ZIP prefixes 00–99 were requested; prefix 09 returned HTTP 403 and is absent. Unsupported ZIPs show an error without changing the active plots. Some ZIPs require county selection.

Subsidy is the available benchmark premium tax credit. Silver is the second-lowest-cost Silver benchmark; Bronze is the lowest-cost estimate. The KFF OOP line uses the saved ceiling table; the CMS OOP line uses the median actual family maximum across available Silver plans. Exact threshold samples are added to the requested income grid to preserve discontinuities.

The calculation reproduces KFF's rating factors, poverty guidelines, subsidy interpolation/rounding, and cost-sharing bands. The page applies employer-coverage and saved income-program eligibility rules. Adult Medicaid/Medi-Cal flags leave Marketplace metrics blank. Children’s Medicaid/CHIP flags automatically remove children under 19 from Marketplace enrollment while preserving eligible adults’ estimates and the full FPL household size. Every listed adult/child is an enrollment candidate; program eligibility determines who is included at each income. Only the three oldest enrolling children under 21 contribute to age-rated premiums. State assistance is not priced. Tobacco surcharges are not priced, matching KFF's limitation; the page flags tobacco use when selected.

The checks cover source-reproduction values, FPL transitions, state rules, enrollment, eligibility gating, the child rating cap, all bundled geographic records, and standalone script validity. Browser automation was not used.

## Refresh KFF and CMS data locally

Requires Node 18 or later, Python 3.9 or later, and an internet connection during refresh. Set `PYTHON` if the Python executable is not named `python3`. No package installation is required. Run this from any directory:

```sh
node /home/mina/repos/aca-visual/site/scripts/update-kff.mjs
```

From the `site` directory, `npm run update-data` does the same thing. Preview a refresh without changing any files:

```sh
node /home/mina/repos/aca-visual/site/scripts/update-kff.mjs --dry-run
```

The script downloads the pinned 2026 KFF rules and ZIP data and the CMS plan/service-area files, checks schema and calculation compatibility, validates estimates for all locations, and builds the compact offline HTML. It ignores non-ZIP placeholder rows. Known unavailable prefix 09 is reported; failures for previously covered prefixes or disappearing ZIPs stop the update. Unexpected changes to KFF's calculation code require review rather than silently using new data with outdated formulas.

Successful refreshes back up the previous data and HTML to `site/backups/<timestamp>/`. Files are staged before replacement; a write failure restores the backup. The script never uploads, pushes, or deploys. It does not switch coverage years; a future year requires reviewing the formulas and page labels.

## CMS Silver cost sharing

The page shows the median annual medical deductible (including combined medical/drug deductibles), fixed to family total, on the Silver out-of-pocket plot, alongside the CMS median family OOP maximum and the KFF ceiling. Deductible type and scope are not inputs. The saved aggregate retains min, median, arithmetic mean, and max for other analysis. It switches between standard Silver (70% AV) and the 73%, 87%, and 94% CSR tiers using the existing eligibility calculation. These statistics describe available plans, not expected spending or the deductible of KFF's benchmark plan. Each unique plan variant has equal weight; no enrollment weighting is applied.

Source: [CMS 2026 Exchange Public Use Files](https://www.cms.gov/marketplace/resources/data/public-use-files), specifically Plan Attributes and Service Area. The current aggregate covers 22,268 ZIPs in 30 states, with 1,453 base Silver plans and 5,812 plan variants. Other states retain KFF estimates but show no CMS deductible data. The CMS files used here do not include marketplaces operating their own enrollment platforms.

ZIP/county relationships come from the existing KFF dataset. [Census county identifiers](https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt) supply FIPS codes. The join respects CMS whole-state, whole-county, and partial-county ZIP restrictions. Multi-county ZIPs retain county-specific results; the data also contains a union of plans offered in any covered portion of each ZIP. A plan offered in two counties counts once in the ZIP union. The page uses the selected county, since a ZIP union may include plans unavailable at a particular address.

Only 2026 individual-market, on-exchange Silver plans are included. SHOP, dental, off-exchange, and American Indian/Alaska Native zero/limited cost-sharing variants are excluded. Each ordinary CSR tier is aggregated separately. Deductibles use in-network tier 1 amounts and preserve three coverage scopes: individual coverage, per person under family coverage, and family total. These family amounts come directly from CMS; they are not inferred from household size.

The `medical` series uses the combined medical/drug deductible for integrated plans and the medical-only deductible for plans with separate deductibles. The other series keep integrated, separate medical, and separate drug plans apart. Empty or not-applicable values are excluded; zero-dollar deductibles are included. Counts accompany each statistic. The average is rounded to cents; the page displays whole dollars. Amounts are annual even when premiums use monthly display.

### Local files

- `data/cms-deductibles.json`: compact aggregate, 902 shared profiles, with source URLs, SHA-256 hashes, coverage counts, and methodology.
- `.cache/cms/2026/`: downloaded CMS ZIP archives and Census county lookup. These files are excluded from Git.
- `scripts/cms-data.py`: download, geography join, filtering, and aggregation using Python's standard library.
- `scripts/cms-refresh.mjs`: invokes CMS processing inside the existing refresh transaction.
- `src/cms-data.mjs`: offline lookup helpers.

The existing `npm run update-data` now refreshes both KFF and CMS, backs up previous files, and rebuilds the standalone HTML. Downloads and calculations are staged before replacing data. Failed downloads, unknown cost-sharing formats, conflicting plan IDs, unmatched covered counties, or loss of previously covered ZIPs stop the refresh. `--dry-run` performs the full download/validation without changing project data, cache, or HTML. Source archives are retained after a successful refresh.

### Aggregate format

`metrics` defines the order of fifteen metric entries: `medical`, `integrated`, `separateMedical`, and `separateDrug`, followed by `oop`, each with `individual`, `familyPerPerson`, and `familyPerGroup`. Each profile has keys `70`, `73`, `87`, and `94`, containing total `plans`, `integratedPlans`, and `stats`. Every statistics array is `[count, min, median, avg, max]`. A missing metric is `[0, null, null, null, null]`.

`locations` entries are `[state, countyName, countyFips, profileIndex, spaceSeparatedZips]`. `zipUnions` entries are `[profileIndex, spaceSeparatedZips]`. Leading-zero ZIPs remain strings. Grouped ZIP references and shared profiles avoid duplicating all fifteen metrics for each ZIP.

Example from the `site` directory:

```js
import fs from 'node:fs';
import {cmsLookup, deductibleStats} from './src/cms-data.mjs';
const data = JSON.parse(fs.readFileSync('data/cms-deductibles.json', 'utf8'));
const profile = cmsLookup(data)['77007|tx|harris'];
console.log(deductibleStats(data, profile, 87, 'medical.individual'));
// [46, 0, 700, 559.13, 1500] in the September 28, 2026 snapshot
```

Tests cover partial-county restrictions, state-wide areas, multi-county unions, duplicate plans, CSR separation, missing versus zero values, mean/median calculation, failed staging, and the bundled aggregate's statistics. Offline DOM interaction checks exercise the combined chart, hover values, and unsupported locations without browser automation.

Hover or tap any plot to show synchronized income, FPL percentage, and visible series values on all plots at once. Premium values follow the monthly/annual setting; OOP and deductible amounts remain annual. Press Escape or move off the plot to dismiss hover values.

Data refresh is explicit only. Ordinary builds use the saved KFF and CMS data; run the refresh command only when new source data is requested.

CMS OOP values use `TEHBInnTier1IndividualMOOP`, `TEHBInnTier1FamilyPerPersonMOOP`, and `TEHBInnTier1FamilyPerGroupMOOP`. These are combined medical/drug limits, selected using `MedicalDrugMaximumOutofPocketIntegrated`, independently of deductible integration. All 5,812 eligible variants in the saved source use integrated OOP limits. A future source with separate OOP limits stops aggregation for review. Missing values are excluded, with reporting counts retained. The chart uses `oop.familyPerGroup` and the same CSR tier as the deductible; all displayed OOP and deductible amounts use family totals, with no scope selector.

The aggregate format is now schema version 2. The original twelve deductible metrics retain their order, with three OOP metrics appended. The historical filename `data/cms-deductibles.json` is retained. The existing explicit refresh command includes OOP aggregation automatically. The initial OOP addition was computed entirely from the saved archives, without refreshing either data source.

For ZIP 77007 / Harris County, the saved CMS median family OOP maxima are $17,900 (70% AV), $14,800 (73%), $6,600 (87%), and $3,050 (94%), each from 46 plans. Deductible and OOP medians are computed separately and need not describe the same plan.

## Program eligibility by income

No conditional eligibility banners appear above the plots; suppressed data remains blank and hover tooltips explain the applicable program. A persistent notice beneath the household inputs explains the child-coverage cutoff and adults-only income range whenever children under 19 are present. The input notice includes the program, income cutoff, and percentage of plotted FPL. The cutoffs use the saved Medicaid poverty baseline, so they can differ from the nominal percentage on the Marketplace FPL axis. California adult coverage is labeled Medi-Cal; its child rule is labeled Medi-Cal (children). Elsewhere the labels are Medicaid and Children’s Medicaid/CHIP.

Adult Medicaid/Medi-Cal flags leave all Marketplace curves blank through the adult cutoff. The inspector and hover omit amounts there. The 100–500% FPL axis remains fixed, with exact samples on both sides of program cutoffs.

Children’s Medicaid/CHIP flags automatically exclude children under 19 from Marketplace enrollment at each applicable income. Eligible adults’ estimates remain visible, with a persistent adults-only range notice beneath the household inputs and income-specific hover details. Children still count toward household size and FPL. There are no enrollment checkboxes. Above the child cutoff, children are included automatically. If all enrollees are excluded, there are no Marketplace estimates.

Premiums and subsidy use effective enrollment after child exclusion. KFF OOP ceilings and CMS medians use family totals throughout; the published family ceiling is not switched to the individual ceiling when only one member is eligible. Ages 19–20 are outside the saved under-19 child rule. These are simplified eligibility flags; Medicare and other programs without saved rules are not modeled. Employer coverage and income above the subsidy limit keep their ordinary unsubsidized estimates unless an adult program flag applies.

The main view omits the household-count badge, duplicate location summary, FPL summary strip, routine status messages, source footer, and explanatory text under the OOP chart. The collapsible Sources section contains only source hyperlinks. The page footer is removed. OOP legend labels omit the repeated family suffix; the chart heading retains the family scope.

The visible top banner and Income & coverage heading are omitted. The adults-only notice stays below the inputs and no longer repeats the FPL household-size explanation. There is no Update plots button; ZIP, county, household, age, tobacco, and employer-coverage inputs trigger updates automatically.
