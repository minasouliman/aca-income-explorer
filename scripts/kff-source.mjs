import {createHash} from 'node:crypto';

// Only data literals are accepted; downloaded JavaScript is never executed.
function literal(source,start) {
  let i=start;
  const skip=()=>{while(true){const m=/^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/.exec(source.slice(i));if(!m)return;i+=m[0].length;}};
  const string=()=>{
    const quote=source[i++];let result='';
    while(i<source.length){const c=source[i++];if(c===quote)return result;if(c!=='\\'){result+=c;continue;}
      const escaped=source[i++];const simple={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};
      if(escaped==='u'||escaped==='x'){const length=escaped==='u'?4:2;const hex=source.slice(i,i+length);if(!new RegExp(`^[a-fA-F0-9]{${length}}$`).test(hex))throw Error('Invalid escape in KFF data');result+=String.fromCharCode(parseInt(hex,16));i+=length;}
      else result+=simple[escaped]??escaped;
    }throw Error('Unterminated KFF data string');
  };
  const parse=()=>{
    skip();const c=source[i];
    if(c==='"'||c==="'")return string();
    if(c==='{'||c==='['){const array=c==='[',end=array?']':'}',value=array?[]:{};i++;skip();
      while(source[i]!==end){
        if(array)value.push(parse());else{
          skip();let key;if(source[i]==='"'||source[i]==="'")key=string();else{const match=/^[A-Za-z_$][\w$]*/.exec(source.slice(i));if(!match)throw Error('Invalid KFF object key');key=match[0];i+=key.length;}
          if(['__proto__','prototype','constructor'].includes(key))throw Error('Unsafe KFF object key');
          skip();if(source[i++]!==':')throw Error('Expected colon in KFF data');value[key]=parse();
        }
        skip();if(source[i]===end)break;if(source[i++]!==',')throw Error('Expected comma in KFF data');skip();
      }i++;return value;
    }
    const number=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if(number){i+=number[0].length;return Number(number[0]);}
    for(const [word,value] of [['true',true],['false',false],['null',null]])if(source.slice(i,i+word.length)===word&&!/[\w$]/.test(source[i+word.length]||'')){i+=word.length;return value;}
    throw Error('KFF rules contain an unsupported expression; review the source before updating.');
  };
  return {value:parse(),end:i};
}
export function parseRules(source) {
  const start=source.indexOf('var SubsidyCalculator = function( props ) {');
  const end=source.indexOf('// render a number with commas',start);
  if(start<0||end<0)throw Error('KFF calculator structure changed; review required.');
  let calculation=source.slice(start,end);const blocks=[];const result={};
  for(const [name,key]of [['p','base'],['overrides','overrides']]){
    const marker=`this.${name} = `;const position=calculation.indexOf(marker);
    if(position<0)throw Error(`Missing KFF ${name} rules`);
    const dataStart=position+marker.length;const parsed=literal(calculation,dataStart);
    result[key]=parsed.value;blocks.push([dataStart,parsed.end,key]);
  }
  for(const [start,end,key]of blocks.sort((a,b)=>b[0]-a[0]))calculation=calculation.slice(0,start)+`<${key}>`+calculation.slice(end);
  return {rules:result,logicHash:createHash('sha256').update(calculation).digest('hex')};
}
export function parseBucket(text,prefix) {
  const match=/^\s*merge_zip_data\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/.exec(text);
  if(!match)throw Error(`Unexpected JSONP wrapper for prefix ${prefix}`);
  const source=JSON.parse(match[1]);
  if(!source||typeof source!=='object'||Array.isArray(source))throw Error(`Invalid ZIP data for ${prefix}`);
  const data={};
  for(const [zip,entry]of Object.entries(source)){
    if(!/^\d{5}$/.test(zip))continue;
    if(!zip.startsWith(prefix))throw Error(`ZIP ${zip} is outside bucket ${prefix}`);
    const records=Array.isArray(entry)?[entry]:Object.values(entry||{});
    if(!records.length)throw Error(`No county records for ${zip}`);
    for(const r of records)if(!Array.isArray(r)||r.length<7||!Number.isFinite(r[0])||!Number.isFinite(r[1])||r[0]<0||r[1]<0||!/^[a-z]{2}$/.test(r[4])||typeof r[5]!=='string')throw Error(`Invalid premium record for ${zip}`);
    data[zip]=entry;
  }
  return data;
}
