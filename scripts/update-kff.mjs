#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {parseRules,parseBucket} from './kff-source.mjs';
import {calculate,withFplRange,sweep} from '../src/engine.mjs';
import {renderPage} from '../build.mjs';
import {refreshCms} from './cms-refresh.mjs';
import {writeLocalFiles} from './local-files.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('Usage: node scripts/update-kff.mjs [--dry-run]\n\nRefresh the pinned 2026 KFF rules, ZIP premiums, and CMS Silver deductibles,\nthen rebuild the local\noffline HTML. --dry-run downloads and validates without changing files.\nBackups are saved locally. Nothing is uploaded or deployed.');
  process.exit(0);
}
if(args.some(arg=>arg!=='--dry-run')){console.error('Unknown argument. Use --help.');process.exit(1);}
const readJSON=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
async function download(url) {
  let last;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
      if(!response.ok){const error=new Error(`HTTP ${response.status}`);error.status=response.status;throw error;}
      return await response.text();
    }catch(error){last=error;if(error.status&&error.status<500&&error.status!==429)break;}
  }
  throw last;
}
function sameSchema(actual,expected,label='rules') {
  if(typeof actual!==typeof expected||Array.isArray(actual)!==Array.isArray(expected)||(actual===null)!==(expected===null))throw Error(`KFF schema changed at ${label}; review required.`);
  if(typeof expected==='number'&&!Number.isFinite(actual))throw Error(`Invalid number at ${label}`);
  if(expected&&typeof expected==='object'){
    if(Object.keys(actual).sort().join('|')!==Object.keys(expected).sort().join('|'))throw Error(`KFF fields changed at ${label}; review required.`);
    for(const key of Object.keys(expected))sameSchema(actual[key],expected[key],`${label}.${key}`);
  }
}
async function main() {
  const [previous,oldZips,oldRules,contract]=await Promise.all(['data/provenance.json','data/zips.json','data/rules.json','data/source-contract.json'].map(readJSON));
  const year=previous.year;
  if(year!==2026)throw Error('This page supports 2026. Review year-specific logic and labels before switching coverage years.');
  const base=`https://files.kff.org/subsidy-calculator/${year}/production`;
  console.log(`Downloading KFF ${year} rules and ZIP data…`);
  const source=await download(`${base}/combined.js`);
  const parsed=parseRules(source);
  if(parsed.logicHash!==contract.logicHash)throw Error('KFF calculation logic changed. No files were changed. Review the formulas before accepting new data.');
  sameSchema(parsed.rules,oldRules);
  const zips={},unavailablePrefixes=[],failures=[];
  const knownMissing=new Set(previous.unavailablePrefixes.map(row=>row[0]));
  const existingPrefixes=new Set(Object.keys(oldZips).filter(zip=>/^\d{5}$/.test(zip)).map(zip=>zip.slice(0,2)));
  let cursor=0,complete=0;
  async function worker(){
    while(cursor<100){
      const prefix=String(cursor++).padStart(2,'0');
      try{Object.assign(zips,parseBucket(await download(`${base}/data/${prefix}.json`),prefix));}
      catch(error){
        if(knownMissing.has(prefix)&&!existingPrefixes.has(prefix)&&[403,404].includes(error.status))unavailablePrefixes.push([prefix,error.message]);
        else failures.push(`${prefix}: ${error.message}`);
      }
      complete++;if(complete%25===0)console.log(`Checked ${complete}/100 ZIP prefixes.`);
    }
  }
  await Promise.all(Array.from({length:6},worker));
  if(failures.length)throw Error(`Refresh stopped; no files changed. Failed prefixes: ${failures.join(', ')}`);
  const oldKeys=Object.keys(oldZips).filter(zip=>/^\d{5}$/.test(zip));
  const missing=oldKeys.filter(zip=>!Object.hasOwn(zips,zip));
  if(missing.length)throw Error(`Refresh would remove ${missing.length} ZIPs (first: ${missing.slice(0,8).join(', ')}). No files changed; review KFF coverage first.`);
  const config={people:[{age:35,kind:'adult',enrolled:true},{age:40,kind:'adult',enrolled:true},{age:10,kind:'child',enrolled:true}],otherHousehold:0,employerCoverage:false,min:0,step:1000};
  for(const entry of Object.values(zips))for(const record of Array.isArray(entry)?[entry]:Object.values(entry)){
    const row=calculate(config,record,60000,parsed.rules);
    for(const field of ['subsidy','silver','grossSilver','silverAV','familyOOP'])if(row.suppressed?row[field]!==null:!Number.isFinite(row[field])||row[field]<0)throw Error(`Invalid calculated ${field} for ${record[4]}/${record[5]}`);
  }
  const sample=sweep(withFplRange(config,parsed.rules,'tx'),zips['77007'],parsed.rules);
  if(Math.abs(sample.points.at(-1).fpl-5)>1e-9)throw Error('500% FPL validation failed');
  const now=new Date();
  const provenance={year,retrieved:now.toISOString().slice(0,10),source:`${base}/data/{prefix}.json`,zipCount:Object.keys(zips).length,unavailablePrefixes:unavailablePrefixes.sort(),rulesSource:`${base}/combined.js`,rulesSha256:digest(source),logicHash:parsed.logicHash};
  const {cms,files:cmsFiles}=await refreshCms(zips);
  let previousCms;
  try {previousCms=await readJSON('data/cms-deductibles.json');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previousCms){
    const zipSet=data=>new Set(data.zipUnions.flatMap(([,zips])=>zips.split(' ')));
    const newZips=zipSet(cms),missing=[...zipSet(previousCms)].filter(zip=>!newZips.has(zip));
    if(missing.length)throw Error(`CMS coverage lost ${missing.length} ZIPs; existing data unchanged. Review source coverage before updating.`);
  }
  const html=renderPage({rules:parsed.rules,zips,provenance,cms});
  for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script);
  const changed=Object.keys(zips).filter(zip=>JSON.stringify(zips[zip])!==JSON.stringify(oldZips[zip])).length;
  console.log(`Validated ${provenance.zipCount.toLocaleString()} ZIPs; ${changed} new or changed ZIP entries; ${JSON.stringify(parsed.rules)===JSON.stringify(oldRules)?'unchanged':'updated'} rules.`);
  console.log(`Offline page: ${Buffer.byteLength(html).toLocaleString()} bytes.`);
  if(unavailablePrefixes.length)console.log(`Still unavailable: prefixes ${unavailablePrefixes.map(row=>row[0]).join(', ')} (no existing ZIP data lost).`);
  if(args.includes('--dry-run')){console.log('Dry run complete. No files changed.');return;}
  const files={
    ...cmsFiles,
    'data/rules.json':JSON.stringify(parsed.rules,null,2)+'\n',
    'data/zips.json':JSON.stringify(zips),
    'data/provenance.json':JSON.stringify(provenance,null,2)+'\n',
    'dist/index.html':html
  };
  const backup=path.join(root,'backups',now.toISOString().replaceAll(':','-')+'-'+process.pid);
  await writeLocalFiles(root,files,backup);
  console.log(`Updated local KFF/CMS data and ${path.join(root,'dist/index.html')}\nBackup: ${backup}\nNo upload or deployment.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
