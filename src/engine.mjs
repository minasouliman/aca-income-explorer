export function parameters(rules, state) {
  return { ...rules.base, ...(rules.overrides[state] || {}) };
}
export function povertyLevel(config, rules, state) {
  const p = parameters(rules, state);
  return p.poverty + (config.people.length + config.otherHousehold - 1) * p.poverty_addition;
}
export function withFplRange(config, rules, state) {
  return {...config,max:5*povertyLevel(config,rules,state)};
}
export function calculate(config, record, income, rules) {
  const state = record[4], p = parameters(rules, state);
  const size = config.people.length + config.otherHousehold;
  const fpl = p.poverty + (size - 1) * p.poverty_addition;
  const medicaidFpl = p.poverty_medicaid + (size - 1) * p.poverty_addition_medicaid;
  const enrolled = config.people.filter(person => person.enrolled);
  const adults = enrolled.filter(person => person.kind === 'adult');
  const children = enrolled.filter(person => person.kind === 'child');
  let annualSilver, annualBronze;
  if (p.alternate_factors) {
    if (adults.length > 2 || adults.length === 0) throw new Error('KFF supports one or two enrolling adults in this state.');
    const category = children.length ? (adults.length === 1 ? 'one_adult_children' : 'two_adult_children') : (adults.length === 1 ? 'individual' : 'couple');
    annualSilver = record[0] * p.alternate_factors[category];
    annualBronze = record[1] * p.alternate_factors[category];
  } else {
    let weight = 0, population = 0;
    for (let age = 21; age <= 64; age++) {
      weight += p.population[age] * p.age_factor[age];
      population += p.population[age];
    }
    // Only the three oldest enrolled children under 21 contribute to premiums.
    const rated = [...adults, ...[...children].sort((a,b) => b.age-a.age).slice(0,3)];
    const factor = rated.reduce((sum, person) => sum + p.age_factor[person.age], 0) * p.premium_factor / (weight / population);
    annualSilver = record[0] * factor;
    annualBronze = record[1] * factor;
  }
  const ratio = income / fpl;
  const medicaid = state === 'wi' ? income <= medicaidFpl : Boolean(p.expanding_medicaid && income <= p.medicaid_threshold * medicaidFpl);
  const eligible = !config.employerCoverage && !medicaid && ratio >= 1 && ratio <= 4;
  let rate = 0, subsidy = 0;
  if (eligible) {
    const considered = ratio === 4 ? 3.999 : ratio;
    const i = p.subsidy_table.findIndex(row => considered < row[0]);
    const row = p.subsidy_table[Math.max(0, i-1)];
    rate = Math.round((row[1] + (ratio-row[0]) * row[2]) * 10000) / 10000;
    subsidy = Math.max(0, annualSilver-income*rate);
  }
  let tier = 0;
  if (eligible) tier = ratio <= 1.5 ? 1 : ratio <= 2 ? 2 : ratio <= 2.5 ? 3 : 0;
  const chip = children.some(person => person.age < 19) && income <= p.chip_threshold * medicaidFpl;
  const noBronze = Number(record[6]) === 1;
  return {
    income, fpl: ratio, subsidy, silver: annualSilver-subsidy,
    bronze: noBronze ? null : Math.max(0, annualBronze-subsidy),
    grossSilver: annualSilver, grossBronze: noBronze ? null : annualBronze,
    silverAV: p.av[tier]*100, bronzeAV: noBronze ? null : 60,
    individualOOP: p.oop_single[tier], familyOOP: enrolled.length > 1 ? p.oop_fam[tier] : p.oop_single[tier],
    medicaid, chip, eligible, rate,
    status: config.employerCoverage ? 'Employer coverage: no premium tax credit modeled.' : medicaid ? 'Likely Medicaid eligible. Marketplace amounts shown without subsidies.' : ratio < 1 ? 'Below 100% FPL: no Marketplace premium tax credit modeled.' : ratio > 4 ? 'Above 400% FPL: no Marketplace premium tax credit.' : 'Marketplace tax credit estimated, subject to eligibility.'
  };
}
export function sweep(config, record, rules) {
  if (!Number.isFinite(config.min) || !Number.isFinite(config.max) || !Number.isFinite(config.step) || config.min < 0 || config.max <= config.min || config.step < 100 || (config.max-config.min)/config.step > 5000) throw new Error('Choose an increasing income range, a step of at least $100, and no more than 5,001 sample points.');
  if (!config.people.some(p => p.enrolled)) throw new Error('Select at least one person to enroll in Marketplace coverage.');
  const fpl = povertyLevel(config,rules,record[4]);
  const samples = [];
  for(let n=0; config.min+n*config.step <= config.max; n++) samples.push(config.min+n*config.step);
  if(samples.at(-1)!==config.max) samples.push(config.max);
  const points = new Set(samples);
  const p=parameters(rules,record[4]);
  const medicaidFpl=p.poverty_medicaid+(config.people.length+config.otherHousehold-1)*p.poverty_addition_medicaid;
  const boundaries = [1,1.33,1.5,2,2.5,3,4].map(v=>v*fpl);
  if(p.expanding_medicaid || record[4]==='wi') boundaries.push(medicaidFpl*(record[4]==='wi'?1:p.medicaid_threshold));
  // Sample both sides of cliffs so a $1,000 grid does not smooth a discontinuity.
  for(const boundary of boundaries) for(const x of [boundary-.01,boundary,boundary+.01]) if(x>=config.min && x<=config.max) points.add(x);
  return {fpl, samples, points:[...points].sort((a,b)=>a-b).map(income=>calculate(config,record,income,rules))};
}
