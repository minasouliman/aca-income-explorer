import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {calculate,sweep,povertyLevel} from './src/engine.mjs';
const rules=JSON.parse(fs.readFileSync('data/rules.json'));
const zips=JSON.parse(fs.readFileSync('data/zips.json'));
const person=(age,kind='adult')=>({age,kind,tobacco:false,enrolled:true});
const config={people:[person(35),person(40),person(10,'child')],otherHousehold:0,employerCoverage:false,min:0,max:150000,step:1000};
const tx=zips['77007'];
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} vs ${b}`);
test('reproduces KFF linked household',()=>{
 const c={...config,people:[person(28),person(21)]};const row=calculate(c,tx,46530,rules);
 approx(row.grossSilver/12,966.3561190009026);approx(row.grossBronze/12,611.5824491804584);approx(row.subsidy/12,681.7476190009024);approx(row.silver/12,284.6085);assert.equal(row.bronze,0);assert.equal(row.silverAV,73);assert.equal(row.familyOOP,16900);
});
test('151 regular samples and correct FPL boundaries',()=>{
 const result=sweep(config,tx,rules);assert.equal(result.fpl,26650);assert.equal(result.samples.length,151);assert.equal(result.samples[0],0);assert.equal(result.samples.at(-1),150000);
 for(const [income,av,oop,eligible] of [[26649.99,70,21200,false],[26650,94,7000,true],[39975,94,7000,true],[39975.01,87,7000,true],[53300,87,7000,true],[53300.01,73,16900,true],[66625,73,16900,true],[66625.01,70,21200,true],[106600,70,21200,true],[106600.01,70,21200,false]]){const r=calculate(config,tx,income,rules);assert.equal(r.silverAV,av);assert.equal(r.familyOOP,oop);assert.equal(r.eligible,eligible);assert.ok(result.points.some(p=>Math.abs(p.income-income)<.0001));}
 for(const p of result.points){assert.ok(p.silver>=0);assert.ok(p.bronze>=0);assert.ok(Number.isFinite(p.subsidy));approx(p.silver+p.subsidy,p.grossSilver);}
});
test('excluding a child preserves household FPL',()=>{
 const c=structuredClone(config);c.people[2].enrolled=false;assert.equal(povertyLevel(c,rules,'tx'),26650);assert.ok(calculate(c,tx,60000,rules).grossSilver<calculate(config,tx,60000,rules).grossSilver);
});
test('employer coverage suppresses financial assistance',()=>{
 const r=calculate({...config,employerCoverage:true},tx,30000,rules);assert.equal(r.subsidy,0);assert.equal(r.silverAV,70);assert.equal(r.familyOOP,21200);
});
const records=Object.values(zips).flatMap(v=>Array.isArray(v)?[v]:Object.values(v));
test('Medicaid suppresses Marketplace assistance',()=>{
 const r=calculate(config,records.find(v=>v[4]==='ca'),30000,rules);assert.equal(r.medicaid,true);assert.equal(r.subsidy,0);assert.equal(r.silverAV,70);
});
test('state poverty and family rating overrides',()=>{
 assert.equal(povertyLevel(config,rules,'ak'),33310);assert.equal(povertyLevel(config,rules,'hi'),30650);
 for(const state of ['ny','vt']){const r=records.find(v=>v[4]===state);approx(calculate(config,r,80000,rules).grossSilver,r[0]*rules.overrides[state].alternate_factors.two_adult_children);}
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
test('every bundled location produces finite default results',()=>{
 for(const r of records){const row=calculate(config,r,60000,rules);for(const key of ['subsidy','silver','grossSilver','silverAV','familyOOP'])assert.ok(Number.isFinite(row[key]),`${r[4]} ${key}`);}
});
test('standalone scripts parse; no external runtime assets; element references resolve',()=>{
 const html=fs.readFileSync('dist/index.html','utf8');assert.ok(!html.includes('/* APPLICATION */'));assert.ok(!/<script[^>]+src=|<link[^>]+rel="stylesheet"/.test(html));
 for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script);
 for(const [,id] of fs.readFileSync('src/app.mjs','utf8').matchAll(/\$\('([^']+)'\)/g))assert.ok(html.includes(`id="${id}"`),`missing ${id}`);
});
