# ACA Income Explorer

A standalone, offline-capable HTML calculator for 2026 KFF Marketplace estimates.

Open `dist/index.html` directly in a browser. All styling, calculation code, and 40,562 ZIP records are embedded in that file. No server, build dependencies, account, or network connection is required to use the downloaded page. The hosted copy is private by default.

Defaults: ZIP 77007; two adults aged 35 and 40; one child aged 10; no tobacco use; all three enrolling; income $0–$150,000 in $1,000 steps. Child age is an editable assumption. Use Update plots after editing household or range inputs. Hover/tap plots or use the keyboard-accessible income slider. Monthly/annual premiums, family/individual out-of-pocket ceilings, and series visibility update immediately.

## Rebuild and check

Run from this directory with Node 18 or later:

```sh
node build.mjs
node test.mjs
```

The source is in `src/`. The build embeds `data/rules.json`, `data/zips.json`, and `data/provenance.json`. No package installation is required. `dist/index.html` is the complete distributable.

## Data and interpretation

KFF source and data were retrieved September 28, 2026. The original script is linked in the page. ZIP prefixes 00–99 were requested; prefix 09 returned HTTP 403 and is absent. Unsupported ZIPs show an error without changing the active plots. Some ZIPs require county selection.

Subsidy is the available benchmark premium tax credit. Silver is the second-lowest-cost Silver benchmark; Bronze is the lowest-cost estimate. Out-of-pocket values are statutory ceilings, not specific plan benefits. Exact threshold samples are added to the requested income grid to preserve discontinuities.

The calculation reproduces KFF's rating factors, poverty guidelines, subsidy interpolation/rounding, and cost-sharing bands. Unlike KFF's raw calculation object, the page applies employer-coverage and adult Medicaid eligibility gates before displaying Marketplace assistance. It retains explicit enrollment choices for children and flags potential Medicaid/CHIP eligibility. Unchecking enrollment preserves the person's contribution to tax-household size. Only the three oldest enrolling children under 21 contribute to age-rated premiums. State assistance is not priced. Tobacco surcharges are not priced, matching KFF's limitation; the page flags tobacco use when selected.

The checks cover source-reproduction values, FPL transitions, state rules, enrollment, eligibility gating, the child rating cap, all bundled geographic records, and standalone script validity. Browser automation was not used.
