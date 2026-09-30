import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function writeLocalFiles(root,files,backup) {
  const stage=await fs.mkdtemp(path.join(os.tmpdir(),'aca-refresh-')),existed=new Set(),written=[];
  try {
    for(const [file,contents] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(backup,file)),{recursive:true});
      try {await fs.copyFile(path.join(root,file),path.join(backup,file));existed.add(file);}
      catch(error) {if(error.code!=='ENOENT')throw error;}
      await fs.mkdir(path.dirname(path.join(stage,file)),{recursive:true});
      await fs.writeFile(path.join(stage,file),contents);
    }
    await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify({existing:[...existed],created:Object.keys(files).filter(file=>!existed.has(file))},null,2));
    try {
      for(const file of Object.keys(files)) {
        await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
        written.push(file);
        await fs.copyFile(path.join(stage,file),path.join(root,file));
      }
    } catch(error) {
      for(const file of written.reverse()) {
        if(existed.has(file))await fs.copyFile(path.join(backup,file),path.join(root,file));
        else await fs.rm(path.join(root,file),{force:true});
      }
      throw Error(`Write failed; previous files restored: ${error.message}`);
    }
  } finally {await fs.rm(stage,{recursive:true,force:true});}
}
