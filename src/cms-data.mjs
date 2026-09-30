export function cmsLookup(data) {
  const lookup={};
  for(const [state,county,fips,profile,zips] of data.locations)for(const zip of zips.split(' '))lookup[`${zip}|${state}|${county}`]=profile;
  return lookup;
}

export function deductibleStats(data,profile,tier,metric) {
  const entry=data.profiles[profile]?.[String(tier)],index=data.metrics.indexOf(metric);
  return entry&&index>=0?entry.stats[index]:[0,null,null,null,null];
}
