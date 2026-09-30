const $ = id => document.getElementById(id);
const money = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
const compact = value => '$' + (Math.abs(value)>=1000 ? `${Number((value/1000).toFixed(1))}k` : Math.round(value));
const colors = {subsidy:'#087e83',silver:'#315fe5',bronze:'#a56216',oop:'#7850c4',deductible:'#087e83',cmsOop:'#b04477'};
const CMS_LOOKUP=cmsLookup(CMS_DATA);
let active, currentIncome=60000, charts=[], zipEntry;
const visibility={subsidy:true,silver:true,bronze:true,silverAV:true,bronzeAV:true,oop:true,dedMedian:true,cmsOop:true};
function renderPeople() {
  const previous=[...document.querySelectorAll('.person')].map(row=>({kind:row.dataset.kind,age:row.querySelector('.age').value,tobacco:row.querySelector('.smoker').checked}));
  const adults=Math.min(6,Math.max(1,Number($('adult-count').value)||1));
  const children=Math.min(8,Math.max(0,Number($('child-count').value)||0));
  $('adult-count').value=adults;$('child-count').value=children;
  $('people').replaceChildren();
  for(const [kind,count] of [['adult',adults],['child',children]]) for(let i=0;i<count;i++) {
    const old=previous.filter(p=>p.kind===kind)[i];
    const row=document.createElement('div');row.className='person';row.dataset.kind=kind;
    const name=`${kind==='adult'?'Adult':'Child'} ${i+1}`, id=`${kind}-${i}`;
    row.innerHTML=`<div class="person-age"><label for="${id}">${name}</label><input id="${id}" class="age" type="number" min="${kind==='adult'?21:0}" max="${kind==='adult'?64:20}" required></div><input class="smoker" type="checkbox" aria-label="${name} uses tobacco">`;
    row.querySelector('.age').value=old?.age??(kind==='adult'?(i===0?35:40):10);
    row.querySelector('.smoker').checked=old?.tobacco??false;
    $('people').append(row);
  }
}
function readConfig() {
  return {
    people:[...document.querySelectorAll('.person')].map(row=>({kind:row.dataset.kind,age:Number(row.querySelector('.age').value),tobacco:row.querySelector('.smoker').checked,enrolled:true})),
    otherHousehold:Number($('other-household').value),employerCoverage:$('employer').checked
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
  $('location').textContent=zipEntry ? 'Location found.' : 'Enter a supported five-digit ZIP code.';
}
function apply() {
  try {
    if(!$('controls').checkValidity()){
      $('error').textContent='Enter a valid ZIP and household values.'+(active?' Plots show the last valid settings.':'');
      $('error').hidden=false;return;
    }
    updateCounty();
    if(!zipEntry) throw new Error('No KFF data for this ZIP code. Check the ZIP and try again.');
    const record=Array.isArray(zipEntry)?zipEntry:zipEntry[$('county').value];
    if(!record||!Number.isFinite(Number(record[0]))||!Number.isFinite(Number(record[1]))) throw new Error('Premium data is unavailable for this county.');
    const config=withFplRange(readConfig(),RULES,record[4]), data=sweep(config,record,RULES);
    active={config,record,...data,cmsProfile:CMS_LOOKUP[`${$('zip').value.trim()}|${record[4]}|${record[5]}`]};
    currentIncome=Math.max(config.min,Math.min(config.max,currentIncome));
    $('inspect').min=0;$('inspect').max=data.samples.length-1;$('inspect').step=1;
    const county=(record[5]||$('county').value).replace(/\b\w/g,c=>c.toUpperCase());
    const location=`${county} County, ${record[4].toUpperCase()} · ${$('zip').value}`;
    $('location').textContent=location;
    renderChildNotice();
    $('error').hidden=true;renderCharts();inspect(currentIncome);
  } catch(error) {
    $('error').textContent=error.message+(active?' Plots still show the last applied settings.':'');$('error').hidden=false;
  }
}
function programCutoff(program) {
  return `${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(program.incomeMax)}/year (${(program.fplMax*100).toFixed(2)}% FPL)`;
}
function renderChildNotice() {
  const program=incomePrograms(active.config,RULES,active.record[4]).find(program=>program.id==='chip');
  const notice=$('child-program-warning');notice.hidden=!program;
  const olderChildren=active.config.people.some(person=>person.kind==='child'&&person.age>=19);
  notice.textContent=program?`${olderChildren?'Children under 19 excluded':'Adults-only estimates'} at or below ${programCutoff(program)} because children under 19 may qualify for ${program.name}. Above this income, children are included automatically.`:'';
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
  let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${container.getAttribute('aria-label')}" aria-description="Use the income slider for exact values.">`;
  for(let i=0;i<=4;i++){
    const value=max*i/4,yy=y(value);
    svg+=`<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" stroke="#e6ebf3"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${percent?Math.round(value)+'%':compact(value)}</text>`;
  }
  const tickCount=width<500?3:6;
  for(let i=0;i<=tickCount;i++){
    const value=xmin+(xmax-xmin)*i/tickCount;
    svg+=`<text x="${x(value)}" y="${height-22}" text-anchor="${i===tickCount?'end':i===0?'start':'middle'}">${i===0||i===tickCount?money(value):compact(value)}</text>`;
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
  container.innerHTML=svg+'<div class="chart-tooltip" role="tooltip" hidden></div>';
  const chart={container,x,y,series,percent,width};charts.push(chart);
  const move=event=>{
    const rect=container.querySelector('svg').getBoundingClientRect();
    const mouseX=(event.clientX-rect.left)/rect.width*width;
    const raw=xmin+(mouseX-left)/innerWidth*(xmax-xmin);
    const nearest=active.samples.reduce((best,v)=>Math.abs(v-raw)<Math.abs(best-raw)?v:best,active.samples[0]);
    inspect(nearest);
    for(const other of charts){
      const tooltip=other.container.querySelector('.chart-tooltip');
      tooltip.hidden=false;
      const containerWidth=other.container.clientWidth;
      const anchor=other.x(currentIncome)/other.width*containerWidth;
      const tooltipWidth=tooltip.offsetWidth||Math.min(300,containerWidth-16);
      const preferred=anchor+16+tooltipWidth>containerWidth?anchor-tooltipWidth-16:anchor+16;
      tooltip.style.left=`${Math.max(8,Math.min(containerWidth-tooltipWidth-8,preferred))}px`;
    }
  };
  container.querySelector('.hit-area').addEventListener('pointermove',move);
  container.querySelector('.hit-area').addEventListener('pointerdown',move);
  container.onpointerleave=()=>{for(const other of charts)other.container.querySelector('.chart-tooltip').hidden=true;};
}
function currentDeductible(row) {
  return deductibleStats(CMS_DATA,active.cmsProfile,row.silverAV,'medical.familyPerGroup');
}
function currentOOP(row) {
  return deductibleStats(CMS_DATA,active.cmsProfile,row.silverAV,'oop.familyPerGroup');
}
function renderCharts() {
  if(!active)return;charts=[];
  const divisor=Number($('premium-period').value),period=divisor===12?'month':'year';
  $('premium-unit').textContent=`$/${period}`;
  const premium=[['subsidy','ACA subsidy',colors.subsidy],['silver','Silver premium',colors.silver],['bronze','Bronze premium',colors.bronze]];
  const av=[['silverAV','Silver',colors.silver],['bronzeAV','Bronze',colors.bronze]];
  legend('premium-legend',premium);legend('av-legend',av);
  plot('premium-chart',premium.filter(s=>visibility[s[0]]).map(([key,label,color])=>({label,color,unit:`/${period}`,value:p=>p[key]==null?null:p[key]/divisor})),260);
  const oopLabel='KFF OOP ceiling';
  const oop=[['oop',oopLabel,colors.oop],['cmsOop','CMS median OOP max',colors.cmsOop],['dedMedian','Median medical deductible',colors.deductible]];
  legend('oop-legend',oop);
  plot('oop-chart',oop.filter(s=>visibility[s[0]]).map(([key,label,color])=>({label,color,unit:'/year',dash:key==='cmsOop',value:p=>key==='oop'?p.familyOOP:key==='cmsOop'?currentOOP(p)[2]:currentDeductible(p)[2]})),250);
  plot('av-chart',av.filter(s=>visibility[s[0]]).map(([key,label,color])=>({label:label+' AV',color,value:p=>p[key],dash:key==='bronzeAV'})),180,true);
  inspect(currentIncome);
}
function inspect(income) {
  if(!active)return;
  const index=active.samples.reduce((best,value,i)=>Math.abs(value-Number(income))<Math.abs(active.samples[best]-Number(income))?i:best,0);
  currentIncome=active.samples[index];const row=calculate(active.config,active.record,currentIncome,RULES);
  const divisor=Number($('premium-period').value),period=divisor===12?'per month':'per year';
  $('inspect').value=index;$('inspect').setAttribute('aria-valuetext',money(currentIncome)+' annual income');$('selected-income').textContent=money(currentIncome);
  $('selected-fpl').textContent=`${(row.fpl*100).toFixed(1)}% FPL`;
  const summaryMoney=value=>value==null?'—':money(value);
  const values=[['ACA subsidy',summaryMoney(row.subsidy==null?null:row.subsidy/divisor),period,colors.subsidy],['Silver premium',summaryMoney(row.silver==null?null:row.silver/divisor),period,colors.silver],['Bronze premium',summaryMoney(row.bronze==null?null:row.bronze/divisor),period,colors.bronze],['Silver OOP ceiling',summaryMoney(row.familyOOP),'family / year',colors.oop],['Silver AV',row.silverAV==null?'—':row.silverAV+'%','Bronze: '+(row.bronzeAV==null?'—':row.bronzeAV+'%'),colors.silver]];
  $('metrics').innerHTML=values.map(([label,value,unit,color])=>`<div class="metric" style="--color:${color}"><span class="metric-label">${label}</span><span class="metric-value">${value}</span><span class="metric-unit">${unit}</span></div>`).join('');
  for(const c of charts){
    const xx=c.x(currentIncome),line=c.container.querySelector('.crosshair');
    line.setAttribute('x1',xx);line.setAttribute('x2',xx);
    c.container.querySelector('.dots').innerHTML=c.series.filter(s=>s.value(row)!=null).map(s=>`<circle cx="${xx}" cy="${c.y(s.value(row))}" r="4" fill="${s.color}" stroke="white" stroke-width="1.5"/>`).join('');
    c.container.querySelector('.chart-tooltip').innerHTML=`<div class="tooltip-income">Income ${money(currentIncome)} · ${(row.fpl*100).toFixed(1)}% FPL</div>`+(!row.suppressed&&row.excludedChildren?`<p class="tooltip-note">${row.adultsOnly?'Adults only':'Children under 19 excluded'}</p>`:'')+(row.suppressed?`<p class="tooltip-note">No Marketplace data · Possible ${row.programs.map(program=>program.name).join(' / ')} eligibility</p>`:c.series.map(s=>{
      const value=s.value(row),formatted=value==null?'Unavailable':c.percent?`${value}%`:`${money(value)}${s.unit||''}`;
      return `<div class="tooltip-row"><span><i style="background:${s.color}"></i>${s.label}</span><strong>${formatted}</strong></div>`;
    }).join(''));
  }
}
document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const chart of charts)chart.container.querySelector('.chart-tooltip').hidden=true;});
$('controls').addEventListener('submit',event=>{event.preventDefault();apply();});
function updateInputs(event) {
  const input=event.target;
  if(input.id==='premium-period'){renderCharts();return;}
  if(input.id==='adult-count'||input.id==='child-count'){
    const kind=input.id==='adult-count'?'adult':'child';
    if(input.value!==''&&input.checkValidity()&&document.querySelectorAll(`.person[data-kind="${kind}"]`).length!==Number(input.value))renderPeople();
  }
  if(input.id==='zip')updateCounty();
  apply();
}
$('controls').addEventListener('input',updateInputs);
$('controls').addEventListener('change',updateInputs);
$('inspect').addEventListener('input',event=>inspect(active.samples[Number(event.target.value)]));
renderPeople();apply();
let resizeFrame;new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(renderCharts);}).observe(document.querySelector('.workspace'));
