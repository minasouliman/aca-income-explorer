import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBucket,parseRules} from './kff-source.mjs';
const wrap=data=>`var SubsidyCalculator = function( props ) { this.p = ${data}; this.overrides = {tx: {expanding_medicaid: 0}}; this.calculate(); } // render a number with commas`;
test('parses data literals and ignores comments',()=>{
 const {rules}=parseRules(wrap("{poverty: 15650, flags: [true, false, null,], /* note */ name: 'silver',}"));assert.equal(rules.base.poverty,15650);assert.equal(rules.base.name,'silver');assert.deepEqual(rules.base.flags,[true,false,null]);
});
test('never evaluates expressions from downloaded source',()=>{
 assert.throws(()=>parseRules(wrap('{poverty: process.exit()}')));assert.throws(()=>parseRules(wrap('{__proto__: {bad: true}}')));
});
test('fingerprint tolerates new constants but detects changed logic',()=>{
 const first=parseRules(wrap('{poverty:15650}'));const second=parseRules(wrap('{poverty:16000}'));assert.equal(first.logicHash,second.logicHash);assert.notEqual(first.logicHash,parseRules(wrap('{poverty:15650}').replace('this.calculate()','this.other()')).logicHash);
});
test('JSONP parser preserves ZIPs and counties, rejects executable suffixes',()=>{
 const record=[7101.12,4494.12,0,0,'tx','harris',null];const data={'77007':record,'77950':{Harris:record},'00zip':record};const text='merge_zip_data('+JSON.stringify(data)+');';const parsed=parseBucket(text,'77');assert.deepEqual(parsed['77007'],record);assert.deepEqual(parsed['77950'].Harris,record);assert.equal(parsed['00zip'],undefined);assert.throws(()=>parseBucket(text+'evil()','77'));assert.throws(()=>parseBucket(text,'78'));
});
