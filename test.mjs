import {packZipData,unpackZipData} from './src/zip-data.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {calculate,sweep,povertyLevel,withFplRange,incomePrograms} from './src/engine.mjs';
const rules=JSON.parse(fs.readFileSync('data/rules.json'));
const zips=JSON.parse(fs.readFileSync('data/zips.json'));
const person=(age,kind='adult')=>({age,kind,tobacco:false,enrolled:true});
const config={people:[person(35),person(40),person(10,'child')],otherHousehold:0,employerCoverage:false,min:0,max:150000,step:1000};
const tx=zips['77007'];
const reference=JSON.parse(fs.readFileSync('fixtures/kff-reference.json'));
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} vs ${b}`);
test('reproduces KFF linked household',()=>{
 const c={...config,people:[person(28),person(21)]};const row=calculate(c,reference.record,46530,reference.rules);
 approx(row.grossSilver/12,966.3561190009026);approx(row.grossBronze/12,611.5824491804584);approx(row.subsidy/12,681.7476190009024);approx(row.silver/12,284.6085);assert.equal(row.bronze,0);assert.equal(row.silverAV,73);assert.equal(row.familyOOP,16900);
});
test('151 regular samples and correct FPL boundaries',()=>{
 const config={people:[person(35),person(40),{...person(10,'child'),enrolled:false}],otherHousehold:0,employerCoverage:false,min:0,max:150000,step:1000};
 const result=sweep(config,tx,rules);assert.equal(result.fpl,26650);assert.equal(result.samples.length,151);assert.equal(result.samples[0],0);assert.equal(result.samples.at(-1),150000);
 for(const [income,av,oop,eligible] of [[26649.99,70,21200,false],[26650,94,7000,true],[39975,94,7000,true],[39975.01,87,7000,true],[53300,87,7000,true],[53300.01,73,16900,true],[66625,73,16900,true],[66625.01,70,21200,true],[106600,70,21200,true],[106600.01,70,21200,false]]){const r=calculate(config,tx,income,rules);assert.equal(r.silverAV,av);assert.equal(r.familyOOP,oop);assert.equal(r.eligible,eligible);assert.ok(result.points.some(p=>Math.abs(p.income-income)<.0001));}
 for(const p of result.points){assert.ok(p.silver>=0);assert.ok(p.bronze>=0);assert.ok(Number.isFinite(p.subsidy));approx(p.silver+p.subsidy,p.grossSilver);}
});
test('excluding a child preserves household FPL',()=>{
 const c=structuredClone(config);c.people[2].enrolled=false;assert.equal(povertyLevel(c,rules,'tx'),26650);assert.ok(calculate(c,tx,60000,rules).grossSilver<calculate(config,tx,60000,rules).grossSilver);
});
test('employer coverage suppresses financial assistance',()=>{
 const r=calculate({...config,people:config.people.map(p=>({...p,enrolled:p.kind==='adult'})),employerCoverage:true},tx,30000,rules);assert.equal(r.subsidy,0);assert.equal(r.silverAV,70);assert.equal(r.familyOOP,21200);
});
const records=Object.values(zips).flatMap(v=>Array.isArray(v)?[v]:Object.values(v));
test('program eligibility leaves Marketplace metrics blank',()=>{
 const r=calculate(config,records.find(v=>v[4]==='ca'),30000,rules);assert.equal(r.medicaid,true);assert.equal(r.suppressed,true);for(const key of ['subsidy','silver','bronze','grossSilver','grossBronze','silverAV','bronzeAV','familyOOP','individualOOP','rate'])assert.equal(r[key],null,key);
});
test('state poverty and family rating overrides',()=>{
 assert.equal(povertyLevel(config,rules,'ak'),33310);assert.equal(povertyLevel(config,rules,'hi'),30650);
 for(const state of ['ny','vt']){const r=records.find(v=>v[4]===state);approx(calculate(config,r,150000,rules).grossSilver,r[0]*rules.overrides[state].alternate_factors.two_adult_children);}
});
test('invalid range or empty enrollment rejected',()=>{
 assert.throws(()=>sweep({...config,max:0},tx,rules));assert.throws(()=>sweep({...config,step:0},tx,rules));assert.throws(()=>sweep({...config,people:config.people.map(p=>({...p,enrolled:false}))},tx,rules));
});
test('fourth child not additionally rated',()=>{
 const a={...config,people:[person(35),person(40),person(10,'child'),person(8,'child'),person(6,'child')]};const b={...a,people:[...a.people,person(3,'child')]};approx(calculate(a,tx,150000,rules).grossSilver,calculate(b,tx,150000,rules).grossSilver);assert.equal(povertyLevel(b,rules,'tx')-povertyLevel(a,rules,'tx'),5500);
});
test('leading-zero ZIPs and multi-county entries preserved',()=>{
 assert.ok(zips['02108']);assert.ok(Object.values(zips).some(v=>!Array.isArray(v)&&Object.keys(v).length>1));
});
test('every bundled location produces finite or program-suppressed results',()=>{
 for(const r of records){const row=calculate(config,r,60000,rules);for(const key of ['subsidy','silver','grossSilver','silverAV','familyOOP'])assert.ok(row.suppressed?row[key]===null:Number.isFinite(row[key]),`${r[4]} ${key}`);}
});
test('standalone scripts parse; no external runtime assets; element references resolve',()=>{
 const html=fs.readFileSync('dist/index.html','utf8');assert.ok(!html.includes('/* APPLICATION */'));assert.ok(!/<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(html));
 for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script);
 for(const [,id] of fs.readFileSync('src/app.mjs','utf8').matchAll(/\$\('([^']+)'\)/g))assert.ok(html.includes(`id="${id}"`),`missing ${id}`);
});

test('compact ZIP lookup round-trips all records and county choices exactly',()=>{
 const packed=packZipData(zips);assert.ok(packed.records.length<records.length);const decoded=unpackZipData(packed);assert.equal(Object.keys(decoded).length,Object.keys(zips).length);for(const [zip,entry] of Object.entries(zips))assert.deepEqual(decoded[zip],entry,zip);assert.ok(JSON.stringify(packed).length<700000);
});
test('fixed 100–500% FPL range excludes lower incomes and preserves both endpoints',()=>{
 const c=withFplRange({...config,min:0,max:999999,step:200},rules,'tx');assert.equal(c.min,26650);assert.equal(c.max,133250);assert.equal(c.step,1000);const result=sweep(c,tx,rules);assert.equal(result.samples.length,108);assert.equal(result.samples[0],26650);assert.equal(result.samples.at(-2),132650);assert.equal(result.samples.at(-1),133250);assert.ok(result.points.every(point=>point.fpl>=1&&point.fpl<=5));
 for(let i=1;i<result.samples.length-1;i++)assert.equal(result.samples[i]-result.samples[i-1],1000);
 const html=fs.readFileSync('dist/index.html','utf8');for(const id of ['income-min','income-max','income-step'])assert.ok(!html.includes(`id="${id}"`));
 for(const state of ['ak','hi','tx']){const cfg=withFplRange(config,rules,state);const record=records.find(row=>row[4]===state);assert.ok(sweep(cfg,record,rules).points.every(point=>point.fpl>=1&&point.fpl<=5));}
 assert.equal(withFplRange({...config,people:config.people.slice(0,2)},rules,'tx').max,105750);
 assert.equal(withFplRange({...config,otherHousehold:1},rules,'tx').max,160750);
 assert.equal(withFplRange(config,rules,'ak').max,166550);
 assert.equal(withFplRange(config,rules,'hi').max,153250);
});

test('Medi-Cal cutoff uses plotted FPL and exact income; adult estimates resume above it',()=>{
 const c={...config,people:config.people.map(p=>({...p,enrolled:p.kind==='adult'}))};
 const ca=zips['90023'],programs=incomePrograms(c,rules,'ca').filter(program=>program.id==='medicaid');
 assert.equal(programs.length,1);assert.equal(programs[0].name,'Medi-Cal');
 assert.equal(programs[0].incomeMax,37701.6);approx(programs[0].fplMax,37701.6/26650);
 for(const income of [26650,37310,37701.6])assert.equal(calculate(c,ca,income,rules).suppressed,true);
 const above=calculate(c,ca,37701.61,rules);assert.equal(above.suppressed,false);assert.equal(above.familyOOP,7000);assert.ok(above.subsidy>0);assert.equal(above.silverAV,94);
});
test('children’s coverage automatically excludes children and preserves adult estimates',()=>{
 const programs=incomePrograms(config,rules,'ca');assert.equal(programs.length,2);
 const child=programs.find(p=>p.id==='chip');assert.equal(child.name,'Medi-Cal (children)');assert.equal(child.incomeMax,72671.2);
 const ca=zips['90023'],row=calculate(config,ca,60000,rules);assert.equal(row.medicaid,false);assert.equal(row.chip,true);assert.ok(row.subsidy>0);assert.equal(row.suppressed,false);assert.equal(row.enrolledCount,2);assert.equal(row.excludedChildren,1);assert.equal(row.adultsOnly,true);
 const c={...config,people:config.people.map(p=>({...p,enrolled:p.kind==='adult'}))};
 assert.equal(povertyLevel(c,rules,'ca'),povertyLevel(config,rules,'ca'));
 approx(row.grossSilver,calculate(c,ca,60000,rules).grossSilver);
 approx(row.subsidy,calculate(c,ca,60000,rules).subsidy);
 const at=calculate(config,ca,child.incomeMax,rules),above=calculate(config,ca,child.incomeMax+.01,rules);
 assert.equal(at.excludedChildren,1);assert.equal(at.enrolledCount,2);assert.equal(at.suppressed,false);
 assert.equal(above.excludedChildren,0);assert.equal(above.enrolledCount,3);assert.ok(above.grossSilver>at.grossSilver);
 assert.equal(calculate(c,ca,child.incomeMax+.01,rules).enrolledCount,2);
 const older={...config,people:[person(35),person(40),person(19,'child')]};assert.ok(!incomePrograms(older,rules,'ca').some(p=>p.id==='chip'));
});
test('effective child exclusion determines premiums while OOP uses family scope',()=>{
 const one={...config,people:[person(35),person(10,'child')]};
 const row=calculate(one,tx,30000,rules);assert.equal(row.enrolledCount,1);assert.equal(row.familyOOP,7000);assert.equal(row.fpl,30000/21150);
 const noAdults={...config,people:config.people.map(p=>({...p,enrolled:p.kind==='child'}))};
 const none=calculate(noAdults,tx,30000,rules);assert.equal(none.enrolledCount,0);assert.equal(none.suppressed,true);assert.equal(none.silver,null);
 const ny=records.find(r=>r[4]==='ny');const n=calculate(config,ny,60000,rules);assert.equal(n.suppressed,false);assert.equal(n.enrolledCount,2);approx(n.grossSilver,ny[0]*rules.overrides.ny.alternate_factors.couple);
});
test('all modeled cutoffs are sampled without bridging the blank region',()=>{
 for(const state of ['ca','tx','wi']){
  const record=records.find(r=>r[4]===state),c=withFplRange(config,rules,state),result=sweep(c,record,rules);
  const programs=incomePrograms(c,rules,state);
  if(state==='tx')assert.deepEqual(programs.map(p=>p.id),['chip']);
  for(const program of programs)if(program.incomeMax>=c.min&&program.incomeMax<c.max){
   const at=result.points.find(p=>Math.abs(p.income-program.incomeMax)<1e-7);
   assert.ok(at);if(program.id==='medicaid')assert.equal(at.silver,null);else{assert.equal(at.chip,true);assert.ok(Number.isFinite(at.silver));}
   assert.ok(result.points.some(p=>Math.abs(p.income-program.incomeMax-.01)<1e-7));
  }
  assert.ok(result.points.filter(p=>p.suppressed).every(p=>p.silver===null&&p.bronzeAV===null&&p.familyOOP===null));
  assert.ok(result.points.filter(p=>!p.suppressed).every(p=>Number.isFinite(p.silver)));
 }
});
