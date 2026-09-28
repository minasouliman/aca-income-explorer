const $ = id => document.getElementById(id);
const money = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
const compact = value => '$' + (Math.abs(value)>=1000 ? `${Number((value/1000).toFixed(1))}k` : Math.round(value));
const colors = {subsidy:'#087e83',silver:'#315fe5',bronze:'#a56216',oop:'#7850c4'};
let active, currentIncome=60000, charts=[], zipEntry;
const visibility={subsidy:true,silver:true,bronze:true,silverAV:true,bronzeAV:true};
function renderPeople() {
  const previous=[...document.querySelectorAll('.person')].map(row=>({kind:row.dataset.kind,age:row.querySelector('.age').value,tobacco:row.querySelector('.smoker').checked,enrolled:row.querySelector('.enroll').checked}));
  const adults=Math.min(6,Math.max(1,Number($('adult-count').value)||1));
  const children=Math.min(8,Math.max(0,Number($('child-count').value)||0));
  $('adult-count').value=adults;$('child-count').value=children;
  $('people').replaceChildren();
  for(const [kind,count] of [['adult',adults],['child',children]]) for(let i=0;i<count;i++) {
    const old=previous.filter(p=>p.kind===kind)[i];
    const row=document.createElement('div');row.className='person';row.dataset.kind=kind;
    const name=`${kind==='adult'?'Adult':'Child'} ${i+1}`, id=`${kind}-${i}`;
    row.innerHTML=`<div class="person-age"><label for="${id}">${name}</label><input id="${id}" class="age" type="number" min="${kind==='adult'?21:0}" max="${kind==='adult'?64:20}" required></div><input class="smoker" type="checkbox" aria-label="${name} uses tobacco"><input class="enroll" type="checkbox" aria-label="${name} enrolls in Marketplace coverage">`;
    row.querySelector('.age').value=old?.age??(kind==='adult'?(i===0?35:40):10);
    row.querySelector('.smoker').checked=old?.tobacco??false;
    row.querySelector('.enroll').checked=old?.enrolled??true;
    $('people').append(row);
  }
  $('people-count').textContent=`${adults+children} people`;
}
function readConfig() {
  return {
    people:[...document.querySelectorAll('.person')].map(row=>({kind:row.dataset.kind,age:Number(row.querySelector('.age').value),tobacco:row.querySelector('.smoker').checked,enrolled:row.querySelector('.enroll').checked})),
    otherHousehold:Number($('other-household').value),employerCoverage:$('employer').checked,
    min:Number($('income-min').value),step:Number($('income-step').value)
  };
}
function updateCounty() {
  zipEntry=ZIP_DATA[$('zip').value.trim()];
  const old=$('county').value;
  $('county').replaceChildren();
  const multiple=zipEntry&&!Array.isArray(zipEntry);
  $('county-wrap').hidden=!multiple;
  if(multiple) for(const name of Object.keys(zipEntry)) {
    const option=document.createElement('option');option.textContent=name;option.value=name;$('county').append(option);
  }
  if(multiple&&Object.hasOwn(zipEntry,old)) $('county').value=old;
  $('location').textContent=zipEntry ? 'Location ready. Update plots to apply.' : 'Enter a supported five-digit ZIP code.';
}
function apply() {
  try {
    if(!$('controls').reportValidity()) return;
    updateCounty();
    if(!zipEntry) throw new Error('No KFF data for this ZIP code. Check the ZIP and try again.');
    const record=Array.isArray(zipEntry)?zipEntry:zipEntry[$('county').value];
    if(!record||!Number.isFinite(Number(record[0]))||!Number.isFinite(Number(record[1]))) throw new Error('Premium data is unavailable for this county.');
    const config=withFplRange(readConfig(),RULES,record[4]), data=sweep(config,record,RULES);
    $('income-max').value=config.max;
    active={config,record,...data};
    currentIncome=Math.max(config.min,Math.min(config.max,currentIncome));
    $('inspect').min=0;$('inspect').max=data.samples.length-1;$('inspect').step=1;
    const county=(record[5]||$('county').value).replace(/\b\w/g,c=>c.toUpperCase());
    const location=`${county} County, ${record[4].toUpperCase()} · ${$('zip').value}`;
    $('location').textContent=location;
    const adults=config.people.filter(p=>p.kind==='adult').length, children=config.people.length-adults;
    $('scenario').textContent=`${location} · ${adults} adult${adults!==1?'s':''}${children?` + ${children} child${children!==1?'ren':''}`:''}`;
    $('people-count').textContent=`${config.people.length+config.otherHousehold} people`;
    $('fpl-strip').innerHTML=[1,1.5,2,2.5].map(x=>`<span>${x*100}% FPL<strong>${money(data.fpl*x)}</strong></span>`).join('');
    $('form-status').textContent=`${data.samples.length} income samples · exact thresholds included.`;
    $('error').hidden=true;renderCharts();inspect(currentIncome);
  } catch(error) {
    $('error').textContent=error.message+(active?' Plots still show the last applied settings.':'');$('error').hidden=false;
  }
}
function legend(id,series) {
  $(id).innerHTML=series.map(([key,label,color])=>`<label style="--color:${color}"><input type="checkbox" data-series="${key}" ${visibility[key]?'checked':''}>${label}</label>`).join('');
  $(id).onchange=event=>{visibility[event.target.dataset.series]=event.target.checked;renderCharts();};
}
function niceMax(value) {
  if(!Number.isFinite(value)||value<=0)return 100;
  const magnitude=10**Math.floor(Math.log10(value));
  return Math.ceil(value/magnitude*2)/2*magnitude;
}
function plot(id,series,height,percent=false) {
  const container=$(id), width=Math.max(280,container.clientWidth), left=58,right=12,top=33,bottom=42;
  const innerWidth=width-left-right,innerHeight=height-top-bottom;
  const {config,points,fpl}=active;
  const xmax=config.max,xmin=config.min;
  const x=value=>left+(value-xmin)/(xmax-xmin)*innerWidth;
  const max=percent?100:niceMax(Math.max(...series.flatMap(s=>points.map(p=>s.value(p)??0))));
  const y=value=>top+(1-value/max)*innerHeight;
  let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${container.getAttribute('aria-label')}"><title>${container.getAttribute('aria-label')}. Use the income slider for exact values.</title>`;
  for(let i=0;i<=4;i++){
    const value=max*i/4,yy=y(value);
    svg+=`<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" stroke="#e6ebf3"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${percent?Math.round(value)+'%':compact(value)}</text>`;
  }
  const tickCount=width<500?3:6;
  for(let i=0;i<=tickCount;i++){
    const value=xmin+(xmax-xmin)*i/tickCount;
    svg+=`<text x="${x(value)}" y="${height-22}" text-anchor="${i===tickCount?'end':i===0?'start':'middle'}">${i===tickCount?money(value):compact(value)}</text>`;
  }
  svg+=`<text x="${left+innerWidth/2}" y="${height-3}" text-anchor="middle">Annual household income</text>`;
  let previousLabel=-100;
  for(const fraction of [1,1.5,2,2.5,4]){
    const value=fpl*fraction;if(value<xmin||value>xmax)continue;
    const xx=x(value),yy=xx-previousLabel<42?12:25;previousLabel=xx;
    svg+=`<line x1="${xx}" x2="${xx}" y1="${top}" y2="${height-bottom}" stroke="${fraction===4?'#c7cfdd':'#99a9c0'}" stroke-dasharray="4 5"/><text class="marker-label" x="${xx}" y="${yy}" text-anchor="middle">${fraction*100}%</text>`;
  }
  for(const s of series) {
    let d='',open=false;
    for(const point of points){const value=s.value(point);if(value==null){open=false;continue;}d+=`${open?'L':'M'}${x(point.income).toFixed(2)},${y(value).toFixed(2)} `;open=true;}
    svg+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"${s.dash?' stroke-dasharray="6 4"':''}/>`;
  }
  svg+=`<line class="crosshair" x1="${x(currentIncome)}" x2="${x(currentIncome)}" y1="${top}" y2="${height-bottom}"/><g class="dots"></g><rect class="hit-area" x="${left}" y="${top}" width="${innerWidth}" height="${innerHeight}"/></svg>`;
  container.innerHTML=svg;
  const chart={container,x,y,series};charts.push(chart);
  const move=event=>{
    const rect=container.querySelector('svg').getBoundingClientRect();
    const mouseX=(event.clientX-rect.left)/rect.width*width;
    const raw=xmin+(mouseX-left)/innerWidth*(xmax-xmin);
    const nearest=active.samples.reduce((best,v)=>Math.abs(v-raw)<Math.abs(best-raw)?v:best,active.samples[0]);
    inspect(nearest);
  };
  container.querySelector('.hit-area').addEventListener('pointermove',move);
  container.querySelector('.hit-area').addEventListener('pointerdown',move);
}
function renderCharts() {
  if(!active)return;charts=[];
  const divisor=Number($('premium-period').value),period=divisor===12?'month':'year';
  $('premium-unit').textContent=`$/${period}`;
  const premium=[['subsidy','ACA subsidy',colors.subsidy],['silver','Silver premium',colors.silver],['bronze','Bronze premium',colors.bronze]];
  const av=[['silverAV','Silver',colors.silver],['bronzeAV','Bronze',colors.bronze]];
  legend('premium-legend',premium);legend('av-legend',av);
  plot('premium-chart',premium.filter(s=>visibility[s[0]]).map(([key,label,color])=>({color,value:p=>p[key]==null?null:p[key]/divisor})),260);
  plot('oop-chart',[{color:colors.oop,value:p=>p[$('oop-scope').value]}],190);
  plot('av-chart',av.filter(s=>visibility[s[0]]).map(([key,label,color])=>({color,value:p=>p[key],dash:key==='bronzeAV'})),180,true);
  inspect(currentIncome);
}
function inspect(income) {
  if(!active)return;
  const index=active.samples.reduce((best,value,i)=>Math.abs(value-Number(income))<Math.abs(active.samples[best]-Number(income))?i:best,0);
  currentIncome=active.samples[index];const row=calculate(active.config,active.record,currentIncome,RULES);
  const divisor=Number($('premium-period').value),period=divisor===12?'per month':'per year';
  $('inspect').value=index;$('inspect').setAttribute('aria-valuetext',money(currentIncome)+' annual income');$('selected-income').textContent=money(currentIncome);
  $('selected-fpl').textContent=`${(row.fpl*100).toFixed(1)}% FPL`;
  const values=[['ACA subsidy',money(row.subsidy/divisor),period,colors.subsidy],['Silver premium',money(row.silver/divisor),period,colors.silver],['Bronze premium',money(row.bronze==null?null:row.bronze/divisor),period,colors.bronze],['Silver OOP ceiling',money(row[$('oop-scope').value]),$('oop-scope').value==='familyOOP'?'family / year':'person / year',colors.oop],['Silver AV',row.silverAV+'%','Bronze: '+(row.bronzeAV==null?'unavailable':row.bronzeAV+'%'),colors.silver]];
  $('metrics').innerHTML=values.map(([label,value,unit,color])=>`<div class="metric" style="--color:${color}"><span class="metric-label">${label}</span><span class="metric-value">${value}</span><span class="metric-unit">${unit}</span></div>`).join('');
  const messages=[row.status];
  if(row.chip)messages.push('An enrolled child may qualify for Medicaid/CHIP; the curves still include that child in Marketplace coverage.');
  if(active.config.people.some(p=>p.enrolled&&p.tobacco))messages.push('Tobacco surcharge excluded: KFF does not price it.');
  if(['ca','co','ct','dc','ma','md','mn','nj','nm','ny','or','vt','wa'].includes(active.record[4]))messages.push('Additional state assistance may apply and is not priced here.');
  $('eligibility').textContent=messages.join(' ');
  for(const c of charts){const xx=c.x(currentIncome);const line=c.container.querySelector('.crosshair');line.setAttribute('x1',xx);line.setAttribute('x2',xx);c.container.querySelector('.dots').innerHTML=c.series.filter(s=>s.value(row)!=null).map(s=>`<circle cx="${xx}" cy="${c.y(s.value(row))}" r="4" fill="${s.color}" stroke="white" stroke-width="1.5"/>`).join('');}
}
$('controls').addEventListener('submit',event=>{event.preventDefault();apply();});
$('controls').addEventListener('input',()=>{$('form-status').textContent='Changes pending — update plots to apply.';});
$('adult-count').addEventListener('change',renderPeople);$('child-count').addEventListener('change',renderPeople);
$('zip').addEventListener('input',updateCounty);
$('inspect').addEventListener('input',event=>inspect(active.samples[Number(event.target.value)]));
$('premium-period').addEventListener('change',renderCharts);$('oop-scope').addEventListener('change',renderCharts);
$('data-note').textContent=`${PROVENANCE.zipCount.toLocaleString()} ZIP codes bundled. KFF data retrieved ${PROVENANCE.retrieved}. The page works offline; source links require internet.`;
renderPeople();apply();
let resizeFrame;new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(renderCharts);}).observe(document.querySelector('.workspace'));
