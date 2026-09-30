import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cmsLookup,deductibleStats} from '../src/cms-data.mjs';
import {writeLocalFiles} from './local-files.mjs';

test('CMS lookup respects county, tier, missing fields, and profile zero',()=>{
  const data={locations:[['tx','harris','48201',0,'77007 77008'],['tx','fort bend','48157',1,'77008']],metrics:['medical.individual'],profiles:[{'94':{stats:[[2,0,50,50,100]]}},{'94':{stats:[[1,500,500,500,500]]}}]};
  const lookup=cmsLookup(data);
  assert.deepEqual(deductibleStats(data,lookup['77008|tx|harris'],94,'medical.individual'),[2,0,50,50,100]);
  assert.equal(deductibleStats(data,lookup['77008|tx|fort bend'],94,'medical.individual')[1],500);
  for(const [profile,tier,metric] of [[undefined,94,'medical.individual'],[0,70,'medical.individual'],[0,94,'absent']])assert.deepEqual(deductibleStats(data,profile,tier,metric),[0,null,null,null,null]);
});

test('local refresh backs up existing files and handles new files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aca-write-test-'));
  try {
    await fs.writeFile(path.join(root,'old'),'before');
    await writeLocalFiles(root,{'old':'after','data/new':'new'},path.join(root,'backup'));
    assert.equal(await fs.readFile(path.join(root,'old'),'utf8'),'after');
    assert.equal(await fs.readFile(path.join(root,'backup/old'),'utf8'),'before');
    assert.equal(await fs.readFile(path.join(root,'data/new'),'utf8'),'new');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'backup/manifest.json'),'utf8')),{existing:['old'],created:['data/new']});
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('staging failure preserves existing data',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aca-write-test-'));
  try {
    await fs.writeFile(path.join(root,'old'),'before');
    await assert.rejects(writeLocalFiles(root,{'old':'after','new':undefined},path.join(root,'backup')));
    assert.equal(await fs.readFile(path.join(root,'old'),'utf8'),'before');
    await assert.rejects(fs.access(path.join(root,'new')));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('bundled CMS profiles have valid ordered statistics and complete tiers',async()=>{
  const data=JSON.parse(await fs.readFile(new URL('../data/cms-deductibles.json',import.meta.url),'utf8'));
  assert.equal(data.year,2026);
  assert.equal(data.schemaVersion,2);
  assert.deepEqual(data.metrics.slice(-3),['oop.individual','oop.familyPerPerson','oop.familyPerGroup']);
  const lookup=cmsLookup(data);
  assert.notEqual(lookup['77007|tx|harris'],undefined);
  assert.equal(lookup['10001|ny|new york'],undefined);
  for(const profile of data.profiles)for(const tier of ['70','73','87','94']){
    assert.ok(profile[tier].plans>=0);
    assert.equal(profile[tier].stats.length,data.metrics.length);
    for(const [n,min,median,avg,max] of profile[tier].stats){
      assert.ok(n<=profile[tier].plans);
      if(!n)assert.deepEqual([min,median,avg,max],[null,null,null,null]);
      else {assert.ok(0<=min&&min<=median&&median<=max);assert.ok(min<=avg&&avg<=max);}
    }
  }
});

test('replacement failure restores old files and removes newly created files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aca-rollback-test-')),copy=fs.copyFile;
  try {
    await fs.writeFile(path.join(root,'old'),'before');
    let failed=false;
    fs.copyFile=async(source,destination,...args)=>{
      if(!failed&&destination===path.join(root,'fail')&&String(source).includes('aca-refresh-')){failed=true;throw Error('simulated disk write failure');}
      return copy(source,destination,...args);
    };
    await assert.rejects(writeLocalFiles(root,{'old':'after','new':'new','fail':'fail'},path.join(root,'backup')),/previous files restored/);
    assert.equal(await fs.readFile(path.join(root,'old'),'utf8'),'before');
    await assert.rejects(fs.access(path.join(root,'new')));
    await assert.rejects(fs.access(path.join(root,'fail')));
  } finally {fs.copyFile=copy;await fs.rm(root,{recursive:true,force:true});}
});
