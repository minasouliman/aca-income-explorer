import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packZipData} from './src/zip-data.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
export function renderPage({rules,zips,provenance,cms=JSON.parse(read('data/cms-deductibles.json'))}) {
  const source=read('src/index.html');
  const safe=value=>JSON.stringify(value).replaceAll('<','\\u003c');
  const zipHelpers=read('src/zip-data.mjs');
  const decoder=zipHelpers.slice(zipHelpers.indexOf('export function unpackZipData')).replace('export function','function');
  const data=`${decoder}\nconst RULES=${safe(rules)};const ZIP_DATA=unpackZipData(${safe(packZipData(zips))});const PROVENANCE=${safe(provenance)};const CMS_DATA=${safe(cms)};`;
  const application=read('src/cms-data.mjs').replaceAll('export function','function')+'\n'+read('src/engine.mjs').replaceAll('export function','function')+'\n'+read('src/app.mjs');
  return source.replace('/* STYLES */',()=>read('src/styles.css')).replace('/* DATA */',()=>data).replace('/* APPLICATION */',()=>application);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const rules=JSON.parse(read('data/rules.json')),zips=JSON.parse(read('data/zips.json')),provenance=JSON.parse(read('data/provenance.json'));
  const html=renderPage({rules,zips,provenance});
  for(const directory of ['dist','docs']) {
    fs.mkdirSync(path.join(root,directory),{recursive:true});
    fs.writeFileSync(path.join(root,directory,'index.html'),html);
  }
  console.log(`Built standalone HTML in dist/ and docs/: ${Buffer.byteLength(html).toLocaleString()} bytes; ${Object.keys(zips).filter(zip=>/^\d{5}$/.test(zip)).length} ZIPs. No upload or deployment.`);
}
