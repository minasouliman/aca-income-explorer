export function packZipData(zips) {
  const records=[],entries=[],groups=[];
  const recordIds=new Map(),entryIds=new Map();
  const intern=record=>{
    const key=JSON.stringify(record);
    if(!recordIds.has(key)){recordIds.set(key,records.length);records.push(record);}
    return recordIds.get(key);
  };
  for(const [zip,entry] of Object.entries(zips)) {
    const reference=Array.isArray(entry)?intern(entry):Object.fromEntries(Object.entries(entry).map(([county,record])=>[county,intern(record)]));
    const key=JSON.stringify(reference);
    if(!entryIds.has(key)){entryIds.set(key,entries.length);entries.push(reference);groups.push([]);}
    groups[entryIds.get(key)].push(/^\d{5}$/.test(zip)?Number(zip):zip);
  }
  return {records,entries,groups};
}
export function unpackZipData({records,entries,groups}) {
  const zips={};
  entries.forEach((entry,index)=>{
    const resolved=typeof entry==='number'?records[entry]:Object.fromEntries(Object.entries(entry).map(([county,id])=>[county,records[id]]));
    // ZIPs are numbers only in storage; lookup keys retain all five digits.
    for(const zip of groups[index])zips[String(zip).padStart(5,'0')]=resolved;
  });
  return zips;
}
