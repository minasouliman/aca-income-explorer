import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

export async function refreshCms(zips) {
  const stage=await fs.mkdtemp(path.join(os.tmpdir(),'aca-cms-'));
  try {
    const zipFile=path.join(stage,'zips.json'),output=path.join(stage,'cms-deductibles.json'),raw=path.join(stage,'raw');
    await fs.writeFile(zipFile,JSON.stringify(zips));
    await new Promise((resolve,reject)=>{
      const child=spawn(process.env.PYTHON||'python3',[fileURLToPath(new URL('./cms-data.py',import.meta.url)),'--zips',zipFile,'--output',output,'--raw-dir',raw],{stdio:'inherit'});
      child.once('error',error=>reject(Error(`CMS refresh needs Python 3.9+ (or set PYTHON): ${error.message}`)));
      child.once('exit',code=>code===0?resolve():reject(Error(`CMS aggregation failed (exit ${code}); existing data unchanged.`)));
    });
    const text=await fs.readFile(output,'utf8'),cms=JSON.parse(text);
    if(cms.year!==2026||cms.coverage.zipCount<1||!cms.profiles.length)throw Error('Invalid CMS aggregate');
    const files={'data/cms-deductibles.json':text};
    for(const source of cms.provenance.sources)files[`.cache/cms/2026/${source.file}`]=await fs.readFile(path.join(raw,source.file));
    return {cms,files};
  } finally {await fs.rm(stage,{recursive:true,force:true});}
}
