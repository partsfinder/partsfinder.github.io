/* PartsFinder: app layer (lookups, parts, cross-references). Diagram engine lives in diagram.js. */

/* ---------- settings ---------- */
const CFG_KEY='ps-settings';
let cfg=(()=>{try{return JSON.parse(localStorage.getItem(CFG_KEY)||'{}')}catch(e){return{}}})();
function saveCfg(){try{localStorage.setItem(CFG_KEY,JSON.stringify(cfg))}catch(e){}updateAiBadge();}

/* ---------- AI layer: Claude inside claude.ai, or the user's own Anthropic API key anywhere else ---------- */
let sample=null;
const samplePromise=(async()=>{try{if(window.claude&&typeof window.claude.use==='function')sample=await window.claude.use('sample');}catch(e){sample=null}updateAiBadge();return sample;})();
function aiMode(){const prov=cfg.provider||'gemini';if(prov==='groq'&&cfg.groqKey)return'groq';if(prov==='gemini'&&cfg.geminiKey)return'gemini';if(prov==='anthropic'&&cfg.apiKey)return'api';if(cfg.geminiKey)return'gemini';if(cfg.groqKey)return'groq';if(cfg.apiKey)return'api';if(sample)return'claude';return'none';}
const liveOn=()=>['api','gemini','groq'].includes(aiMode())&&!!cfg.live;
function updateAiBadge(){const m=aiMode(),b=$('#aiBadge');if(!b)return;
  b.textContent=(m==='gemini'?(cfg.groqKey?'Gemini + Groq':'Gemini'):m==='groq'?(cfg.geminiKey?'Groq + Gemini':'Groq'):m==='api'?'Claude API':m==='claude'?'Claude':'Set up lookups')+(['gemini','api','groq'].includes(m)&&cfg.live?' · live':'');b.className='badge '+(m==='none'?'bad':'ok');
  const n=$('#aiNote');if(n){n.hidden=m!=='none';n.innerHTML='Lookups need an AI key. Open <b>Settings</b> and paste a free Google Gemini key (takes a minute to get). Engine sketches work without one.';}}
function parseLoose(t){if(t==null)throw new Error('Empty answer');if(typeof t==='object')return t;t=String(t);
  const fence=t.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fence&&fence[1].includes('{'))t=fence[1];
  const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<0)throw new Error('The answer had no data in it');return JSON.parse(t.slice(a,b+1));}
async function apiCall(prompt,{web=false,maxTokens=12000,meta=null}={}){
  const body={model:cfg.model||'claude-sonnet-5-5',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]};
  if(web)body.tools=[{type:'web_search_20250305',name:'web_search',max_uses:6}];
  let r;try{r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':cfg.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify(body)});}
  catch(e){const x=new Error('Couldn’t reach the Anthropic API from this page.');x.code='network';throw x;}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const x=new Error(j?.error?.message||('HTTP '+r.status));x.code=r.status===429||r.status===529?'rate_limited':r.status===401||r.status===403?'bad_key':'api';throw x;}
  if(meta){meta.sources=[];meta.evidence=[];(j.content||[]).filter(b=>b.type==='web_search_tool_result'&&Array.isArray(b.content)).forEach(b=>b.content.forEach(x=>x.url&&meta.sources.push({uri:x.url,title:x.title||x.url})));(j.content||[]).filter(b=>b.type==='text'&&Array.isArray(b.citations)).forEach(b=>b.citations.forEach(c=>{let host='';try{host=new URL(c.url).hostname;}catch(e){}meta.evidence.push({text:`${b.text} ${c.cited_text||''}`,uri:c.url,domain:host});}));meta.supported=meta.evidence.map(e=>e.text).join(' \n ');}
  return(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');}
const GEM_MODELS=['gemini-flash-latest','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3-flash-preview','gemini-2.5-flash','gemini-flash-lite-latest'];
const GBASE='https://generativelanguage.googleapis.com/v1beta';
async function gfetch(url,opt,ms){const ac=new AbortController();const t=setTimeout(()=>ac.abort(),ms);
  try{return await fetch(url,{...opt,signal:ac.signal});}
  catch(e){const x=new Error(e.name==='AbortError'?'Gemini took too long to answer. Try again; the free tier is sometimes slow at busy times.':'Couldn’t reach the Gemini API from this page. Check your connection.');x.code=e.name==='AbortError'?'timeout':'network';throw x;}
  finally{clearTimeout(t);}}
let gList=null;
async function geminiModels(){if(gList)return gList;let found=[];
  try{const r=await gfetch(`${GBASE}/models?pageSize=200`,{headers:{'x-goog-api-key':cfg.geminiKey}},15000);const j=await r.json();
    if(r.status===400||r.status===401||r.status===403){const x=new Error(j?.error?.message||'Key rejected');x.code='bad_key';throw x;}
    const ver=n=>parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/)||[])[1]||0);
    found=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace(/^models\//,''))
      .filter(n=>/flash/.test(n)&&!/image|tts|audio|live|embed|thinking-exp|exp-/.test(n))
      .sort((a,b)=>(/lite/.test(a)-/lite/.test(b))||(/preview/.test(a)-/preview/.test(b))||ver(b)-ver(a));}
  catch(e){if(e.code==='bad_key')throw e;}
  const lites=found.filter(n=>/lite/.test(n)&&!/preview/.test(n)).slice(0,2);gList=[...new Set([cfg.gModel,...found.filter(n=>!/lite/.test(n)).slice(0,4),...GEM_MODELS,...lites].filter(Boolean))];return gList;}
const gSlow=new Set();
function gBody(prompt,m,{web,maxTokens,think}){const gc={maxOutputTokens:maxTokens};if(think)gc.thinkingConfig=/gemini-2\./.test(m)?{thinkingBudget:512}:{thinkingLevel:'low'};
  const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:gc};if(web)body.tools=[{google_search:{}}];return body;}
async function geminiOnce(prompt,m,o={},ms){let think=!cfg.gNoThink;
  for(let attempt=0;attempt<2;attempt++){
    const r=await gfetch(`${GBASE}/models/${m}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':cfg.geminiKey},body:JSON.stringify(gBody(prompt,m,{...o,think}))},ms);
    const j=await r.json().catch(()=>({}));
    if(r.ok){const c=j.candidates?.[0];if(o.meta){const gm=c?.groundingMetadata||{};o.meta.sources=(gm.groundingChunks||[]).map(g=>g.web).filter(Boolean).map(w=>({uri:w.uri,title:w.title||w.domain||w.uri}));o.meta.supported=(gm.groundingSupports||[]).map(x=>x.segment?.text||'').join(' \n ');const ch=gm.groundingChunks||[];o.meta.evidence=(gm.groundingSupports||[]).flatMap(x=>(x.groundingChunkIndices||[]).map(i=>{const w=ch[i]?.web||{};return{text:x.segment?.text||'',uri:w.uri||'',domain:String(w.domain||w.title||'').toLowerCase()};}));}const t=(c?.content?.parts||[]).filter(p=>p.text&&!p.thought).map(p=>p.text).join('');
      if(!t){const x=new Error(c?.finishReason?`No answer (${c.finishReason}).`:(j.promptFeedback?.blockReason?`Blocked (${j.promptFeedback.blockReason}).`:'Empty answer.'));x.code='empty';throw x;}return t;}
    const msg=j?.error?.message||('HTTP '+r.status);
    if(r.status===400&&think&&/think/i.test(msg)){think=false;cfg.gNoThink=true;saveCfg();continue;}
    const x=new Error(msg);x.status=r.status;const det=j?.error?.details||[];const ri=det.find(d=>/RetryInfo/.test(d['@type']||''));x.retry=ri?parseFloat(ri.retryDelay)||0:0;x.daily=/per ?day|PerDay|daily/i.test(JSON.stringify(det)+msg);x.code=(r.status===401||r.status===403||(r.status===400&&/api key/i.test(msg)))?'bad_key':r.status===429?'rate_limited':'api';throw x;}}
let gChain=Promise.resolve();
function toast(t){let el=$('#toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';document.body.appendChild(el);}if(!t){el.classList.remove('on');return;}el.textContent=t;el.classList.add('on');}
async function waitSecs(n,why){for(let k=Math.ceil(n);k>0;k--){toast(`${why} Retrying in ${k}s…`);await new Promise(r=>setTimeout(r,1000));}toast('');}
function geminiCall(prompt,o={}){const run=()=>geminiCallInner(prompt,o);const p=gChain.then(run,run);gChain=p.catch(()=>{});return p;}
async function geminiCallInner(prompt,{web=false,maxTokens=16000,tier='default',meta=null}={},round=0){const all=await geminiModels();const fast=tier==='quick'||(tier==='parts'&&(cfg.speed||'fast')==='fast');
  let list=fast?[...all.filter(m=>/lite/.test(m)),...all.filter(m=>!/lite/.test(m))]:all;
  list=[...list.filter(m=>!gSlow.has(m)),...list.filter(m=>gSlow.has(m))];
  const ms=web?100000:tier==='quick'?25000:60000;let last=null,tries=0,rl=[];
  for(const m of list){if(tries>=5)break;tries++;
    try{const t=await geminiOnce(prompt,m,{web,maxTokens,meta},ms);gSlow.delete(m);if(!/lite/.test(m)&&cfg.gModel!==m){cfg.gModel=m;saveCfg();}return t;}
    catch(e){last=e;
      if(e.code==='bad_key'||e.code==='network')throw e;
      if(e.code==='timeout'){gSlow.add(m);continue;}
      if(e.code==='rate_limited'){rl.push(e);continue;}
      if(e.code==='empty')continue;
      if(cfg.gModel===m)cfg.gModel='';continue;}}
  if(rl.length&&rl.length===tries||(last&&last.code==='rate_limited')){
    const daily=rl.length&&rl.every(e=>e.daily);
    if(!daily&&round<2){const wait=Math.min(60,Math.max(8,...rl.map(e=>e.retry||0)));await waitSecs(wait,'Free-tier limit reached.');return geminiCallInner(prompt,{web,maxTokens,tier,meta},round+1);}
    if(web){toast('Web search limit reached, answering without it.');setTimeout(()=>toast(''),4000);return geminiCallInner(prompt,{web:false,maxTokens,tier,meta},round);}
    const x=new Error(daily?'You’ve used today’s free Gemini allowance. It resets around 5–6pm Brisbane time (midnight in California).':'Google’s free tier is busy for your key. Wait a minute and try again.');x.code='rate_limited_msg';throw x;}
  if(last&&last.code==='timeout'){last.message='Every Gemini model on your key was too slow just now. Open Settings and tap Test my key, then send me a screenshot.';}
  throw last||new Error('No Gemini model on your key could answer. Try again in a minute.');}
async function geminiDiag(){const out=$('#sDiag');const key=$('#sGem').value.trim();if(!key){out.innerHTML='<div class="errbox">Paste your key first.</div>';return;}
  const prev=cfg.geminiKey;cfg.geminiKey=key;gList=null;out.innerHTML=skel('Checking your key…');let html='';
  try{const t0=Date.now();const r=await gfetch(`${GBASE}/models?pageSize=200`,{headers:{'x-goog-api-key':key}},15000);const j=await r.json().catch(()=>({}));
    if(!r.ok){out.innerHTML=`<div class="errbox">Key check failed (${r.status}): ${esc(j?.error?.message||'')}</div>`;cfg.geminiKey=prev;return;}
    const names=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/',''));
    html+=`<p class="small">✅ Key works (${Date.now()-t0} ms). ${names.length} models available.</p>`;out.innerHTML=html+skel('Timing models…');
    const list=await geminiModels();const pick=[...list.filter(m=>/lite/.test(m)).slice(0,2),...list.filter(m=>!/lite/.test(m)).slice(0,3)];
    let rows='';for(const m of pick){const t1=Date.now();let res;
      try{await geminiOnce('Reply with just the word OK.',m,{web:false,maxTokens:200},20000);res=`<span style="color:var(--ok)">${((Date.now()-t1)/1000).toFixed(1)} s</span>`;}
      catch(e){res=`<span class="errbox">${esc(e.code==='timeout'?'over 20 s':(e.message||'').slice(0,90))}</span>`;}
      rows+=`<tr><td><code>${esc(m)}</code></td><td>${res}</td></tr>`;out.innerHTML=html+`<table class="xt">${rows}</table>`+skel('Timing models…');}
    out.innerHTML=html+`<table class="xt">${rows}</table><p class="small muted">Screenshot this if lookups are still slow.</p>`;}
  catch(e){out.innerHTML=errBox(e);}
  cfg.geminiKey=prev;gList=null;}
/* ---------- Groq (free, fast; groq/compound has built-in web search) ---------- */
async function groqOnce(prompt,model,{maxTokens,meta},ms){const body={model,messages:[{role:'user',content:prompt}],max_tokens:maxTokens,temperature:0.2};
  const r=await gfetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+cfg.groqKey},body:JSON.stringify(body)},ms);
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const msg=j?.error?.message||('HTTP '+r.status);const x=new Error('Groq: '+msg);x.code=r.status===401||r.status===403?'bad_key':r.status===429?'rate_limited':'api';x.retry=parseFloat(r.headers.get('retry-after'))||0;x.daily=/per day|RPD|TPD|daily/i.test(msg);throw x;}
  const m=j.choices?.[0]?.message||{};
  if(meta){const urls=[],ev=[];const walk=o=>{if(!o)return;if(Array.isArray(o))return o.forEach(walk);if(typeof o==='object'){if(typeof o.url==='string'){urls.push({uri:o.url,title:o.title||o.url});let host='';try{host=new URL(o.url).hostname;}catch(e){}ev.push({text:`${o.title||''} ${o.content||''}`,uri:o.url,domain:host});}Object.values(o).forEach(walk);}};walk(m.executed_tools);meta.sources=urls.filter((u,k,a)=>a.findIndex(t=>t.uri===u.uri)===k).slice(0,15);meta.evidence=ev;meta.supported=ev.map(e=>e.text).join(' \n ');}
  const t=m.content||'';if(!t){const x=new Error('Groq gave an empty answer.');x.code='empty';throw x;}return t;}
async function groqCall(prompt,{web=false,maxTokens=8000,tier='default',meta=null}={}){
  const models=web?['groq/compound','groq/compound-mini']:tier==='quick'?['openai/gpt-oss-20b','llama-3.3-70b-versatile']:['openai/gpt-oss-120b','llama-3.3-70b-versatile','openai/gpt-oss-20b'];
  let last;for(const m of models){try{return await groqOnce(prompt,m,{maxTokens:Math.min(maxTokens,m.startsWith('groq/')?8000:6000),meta},web?90000:45000);}
    catch(e){last=e;if(e.code==='bad_key'||e.code==='network')throw e;continue;}}
  if(web&&last&&last.code!=='bad_key'){return groqCall(prompt,{web:false,maxTokens,tier,meta});}
  throw last;}
const FAILOVER=['rate_limited_msg','rate_limited','timeout','api','empty'];
async function ask(prompt,o={}){await samplePromise;const m=aiMode();if(m==='none')throw{code:'nokey'};let text;
  if(m==='gemini'){try{text=await geminiCall(prompt,o);}catch(e){
      if(cfg.groqKey&&FAILOVER.includes(e.code)){toast('Gemini is busy, so this one is coming from Groq.');setTimeout(()=>toast(''),3500);text=await groqCall(prompt,o);}
      else if(o.web&&e.code==='api'){text=await geminiCall(prompt,{...o,web:false});}else throw e;}}
  else if(m==='groq'){try{text=await groqCall(prompt,o);}catch(e){
      if(cfg.geminiKey&&FAILOVER.includes(e.code)){toast('Groq is busy, so this one is coming from Gemini.');setTimeout(()=>toast(''),3500);text=await geminiCall(prompt,o);}else throw e;}}
  else if(m==='api'){try{text=await apiCall(prompt,o);}catch(e){if(o.web&&e.code==='api'){text=await apiCall(prompt,{...o,web:false});}else throw e;}}
  else{if(o.json&&typeof sample.json==='function'){try{return parseLoose(await sample.json(prompt,{modelTier:o.tier==='quick'?'quick':'default'}));}catch(e){if(e&&e.code)throw e;}}
    const r=await sample(prompt,{modelTier:o.tier==='quick'?'quick':'default',cache:o.cache});text=r.text;}
  return o.json?parseLoose(text):text;}
function errMsg(e){if(!e)return'Something went wrong.';
  if(e.code==='nokey')return'No AI key set up yet. Open Settings and paste your free Gemini key.';
  if(e.code==='bad_key')return'The API key was rejected. Check it in Settings.';
  if(e.code==='not_granted')return'Claude access wasn’t allowed for this page. Allow it, or add an API key in Settings.';
  if(e.code==='timeout'||e.code==='network')return e.message;
  if(e.code==='rate_limited_msg')return e.message;
  if(e.code==='rate_limited')return'Hit the speed limit for your key. Wait a minute and try again.';
  return'Lookup failed: '+(e.message||String(e));}
const errBox=e=>`<div class="errbox">${esc(errMsg(e))}${e&&(e.code==='nokey'||e.code==='bad_key')?' <button class="linkbtn" data-open-settings type="button">Open settings</button>':''}</div>`;
const skel=t=>`<div class="skel"><span class="spin"></span>${esc(t)}<span class="mono muted tick" data-t0="${Date.now()}"></span></div>`;
setInterval(()=>$$('.tick').forEach(e=>{e.textContent=' '+Math.round((Date.now()-+e.dataset.t0)/1000)+'s';}),1000);
let stTimer=null;function status(html,loading,err){clearInterval(stTimer);const el=$('#status');if(!html){el.innerHTML='';return;}el.innerHTML=`<div class="card st ${err?'err':''}">${loading?'<span class="spin"></span>':''}<span>${html}</span>${loading?'<span class="mono muted" id="stSecs" style="margin-left:auto"></span>':''}</div>`;
  if(loading){const t0=Date.now();stTimer=setInterval(()=>{const e=$('#stSecs');if(!e){clearInterval(stTimer);return;}const s=Math.round((Date.now()-t0)/1000);e.textContent=s+'s';},1000);}}
document.addEventListener('click',e=>{if(e.target.closest('[data-open-settings]'))openSettings();});

/* ---------- vocab ---------- */
const ABBR={lca:'lower control arm',uca:'upper control arm',cv:'CV joint / drive shaft',tre:'tie rod end',bj:'ball joint',swb:'sway bar link','sway link':'sway bar link',drl:'daytime running light',tpms:'tyre pressure sensor',maf:'mass airflow sensor',map:'manifold pressure sensor',o2:'oxygen sensor',egr:'EGR valve',dpf:'diesel particulate filter',pcv:'PCV valve',abs:'ABS sensor',ecu:'engine control unit',bcm:'body control module',iac:'idle air control valve',tps:'throttle position sensor',ckp:'crank position sensor',cmp:'cam position sensor',ect:'coolant temp sensor',iat:'intake air temp sensor','w/b':'wiper blade',wb:'wiper blade','h/l':'headlight','t/l':'tail light','t/g':'tailgate',hlg:'headlight globe',ind:'indicator','rh':'right-hand (driver side in AU)','lh':'left-hand (passenger side in AU)',dba:'brake rotors',wp:'water pump','t/belt':'timing belt',tb:'timing belt',ps:'power steering',atf:'automatic transmission fluid',cvt:'CVT fluid',ac:'air conditioning','a/c':'air conditioning',hid:'HID xenon globe',led:'LED globe',rwc:'roadworthy items',cat:'catalytic converter',sv:'solenoid valve',vvt:'variable valve timing solenoid',hgk:'head gasket kit',rms:'rear main seal',fms:'front main seal',ccv:'crankcase ventilation',clip:'trim clip'};
function expandAbbr(q){const hits=[];const words=q.toLowerCase().split(/[\s,]+/).filter(Boolean);words.forEach(w=>{if(ABBR[w])hits.push(`${w.toUpperCase()} = ${ABBR[w]}`);});if(ABBR[q.toLowerCase().trim()]&&!hits.length)hits.push(`${q.toUpperCase()} = ${ABBR[q.toLowerCase().trim()]}`);return hits;}
const CATS=[['Service & filters','Service parts: oil filter, air filter, cabin filter, fuel filter, spark plugs or glow plugs, sump plug and crush washer, drive belt'],
['Lighting & globes','Every globe on the car: headlight low and high beam, DRL, park, front and rear indicators, side repeaters, fog, tail, stop, high-mount stop, reverse, number plate, interior, boot and glovebox. Give globe type, base, wattage and voltage'],
['Fuses & relays','Fuse boxes (engine bay and cabin): location, key fuse positions with rating, type (mini, micro2, ATO, low-profile, JCASE, MAXI) and what they protect, plus main relays'],
['Wipers & washers','Front driver and passenger wiper blades and rear blade with lengths in mm and inches and arm connector type, refills, arms, washer pump, jets'],
['Trims & clips','Body and interior clips and fasteners: bumper clips, wheel arch liner clips, engine splash shield fasteners, door card clips, kick panel and pillar trim clips, push rivets, bonnet insulation clips. Give hole size and head diameter where known'],
['Brakes','Front and rear pads, rotors (diameter and min thickness), drums and shoes if fitted, calipers, hoses, sensors, brake fluid spec'],
['Suspension & steering','Struts/shocks, springs, lower and upper control arms, ball joints, sway bar links and bushes, tie rod ends, rack ends, wheel bearings and hubs, wheel alignment specs'],
['Engine','Gaskets and seals, timing kit, water pump, thermostat, engine mounts, coils, injectors, sensors, PCV'],
['Cooling & A/C','Radiator, hoses, cap, overflow bottle, fan, coolant spec, A/C compressor, condenser, receiver drier, refrigerant type and charge'],
['Electrical & battery','Battery (group size, CCA, terminal type), alternator, starter, horn, switches, key/remote battery'],
['Driveline','CV shafts and boots, clutch kit or transmission service parts, gearbox and diff oils, tail shaft, gearbox mounts'],
['Body & glass','Mirrors and mirror glass, door handles, bonnet and tailgate struts (length and force), weatherstrips, windscreen, badges'],
['Fasteners & threads','Wheel nuts or bolts (thread size, pitch, seat type, torque), wheel studs, sump plug thread, common body bolt sizes, tow points'],
['Fluids','Every fluid: engine oil, coolant, transmission, diff/transfer, brake, power steering, washer. Specs and capacities'],
['Interior','Cabin filter, interior globes, trim panels and clips, floor mat clips, seat belt parts, 12V sockets'],
['Exhaust','Manifold gasket, flex pipe, catalytic converter, mufflers, hangers, O2 sensors, DPF/EGR parts']];
const STORES=[['Repco','repco.com.au'],['Supercheap','supercheapauto.com.au'],['Autobarn','autobarn.com.au'],['Burson','burson.com.au'],['Sparesbox','sparesbox.com.au'],['Autopro','autopro.com.au']];
const qv=s=>encodeURIComponent(s);
const gsite=(q,d)=>`https://www.google.com/search?q=${qv(q+' site:'+d)}`;
const ebay=q=>`https://www.ebay.com.au/sch/i.html?_nkw=${qv(q)}`;
const lnk=(u,t)=>`<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>`;
const STORE_SEARCH={Repco:q=>`https://www.repco.com.au/search?text=${qv(q)}`};
function storeLinks(q,few){const pref=(cfg.store||'Repco').toLowerCase();const ord=[...STORES].sort((x,y)=>(y[0].toLowerCase()===pref)-(x[0].toLowerCase()===pref));const s=few?ord.slice(0,3):ord;return s.map(([n,d])=>lnk(STORE_SEARCH[n]?STORE_SEARCH[n](q):gsite(q,d),n)).join('')+lnk(ebay(q),'eBay');}
const vshort=()=>{const v=st.vehicle||{};return[v.year,v.make,v.model].filter(Boolean).join(' ')||v.vehicle||'';};

const DEFAULT_BRANDS='Ryco, Repco, ProSelect, Protex, Bendix, SAAS, Permaseal, Payen, ACL Engine Parts';
if(cfg.brands==='Ryco, Repco, ProSelect, Protex, Bendix, SAAS, Permaseal')delete cfg.brands;
const prefBrands=()=>(cfg.brands||DEFAULT_BRANDS).split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
const isPref=b=>{const n=normN(b);return!!n&&prefBrands().some(x=>{const y=normN(x);return n===y||n.startsWith(y);});};
function brandRule(){const b=prefBrands();return b.length?`PRIORITY BRANDS: the customer shops at ${cfg.store||'Repco'}, which stocks ${b.join(', ')}. When one of these brands genuinely makes this exact part AND you have a real number for it, list it first with "store":"${cfg.store||'Repco'}". Never list a priority brand just to fill the slot, and never for a product type it doesn't make.`:'';}
/* ---------- genuine-catalogue evidence ---------- */
const GENUINE=/partsouq|amayama|megazip|7zap|catcar|epc-data|japan-parts|partsnissan|nissanpartsdeal|toyotapartsdeal|parts\.toyota|toyota-parts|lexuspartsnow|mazdaparts|mitsubishipartswarehouse|hondapartsnow|subarupartsdeal|parts\.hyundai|kiapartsnow|realoem|mbparts|vwparts|audiusaparts|fordparts/i;
function genuineFor(meta,num){const n=normN(num);if(n.length<5||!meta||!meta.evidence)return null;const e=meta.evidence.find(x=>GENUINE.test(`${x.domain} ${x.uri}`)&&normN(x.text).includes(n));
  if(!e)return null;let d=e.domain;const m=String(e.domain).match(GENUINE);if(m)d=m[0].toLowerCase();return{uri:e.uri,domain:d};}
/* ---------- number-format rules: things AI can't fake ---------- */
const DEFAULT_RULES='Repco, Permaseal: rocker cover gasket|valve cover gasket|cam cover gasket|head cover gasket|rocket cover gasket = RC\nPermaseal: manifold gasket = MS, MG, MP, EM\nPermaseal: timing cover = TCS\nPayen: valve cover gasket|rocker cover gasket = JM, JP\nACL: valve cover gasket|rocker cover gasket = JN\nRepco: oil filter = ROF\nRepco: air filter = RAF\nRepco: cabin filter|cabin air filter|pollen filter = RCF\nRepco: fuel filter|fuel pre-filter|fuel prefilter = RDF, RDK\nRepco: filter service kit|filter kit = RFSK\nRepco: wiper blade = RCB\nRyco: oil filter|fuel filter = Z, R\nRyco: service kit|filter kit = RSK\nBendix: brake pad = DB\nDBA, Disc Brake Australia: caliper = DBAC\nDBA, Disc Brake Australia: rotor|disc = DBA\nOEX: water pump = WP\nOEX: alternator = HXA\nOEX: starter = HXS\nOEX: speed sensor|abs sensor = OSS';
const OLD_RULES=['Repco, Permaseal: gasket = RC','Repco, Permaseal: rocker cover gasket|valve cover gasket|cam cover gasket = RC','Repco, Permaseal: rocker cover gasket|valve cover gasket|cam cover gasket|head cover gasket|rocket cover gasket = RC\nPermaseal: manifold gasket = MS, MG, MP, EM\nPermaseal: timing cover = TCS\nPayen: valve cover gasket|rocker cover gasket = JM, JP\nACL: valve cover gasket|rocker cover gasket = JN'];
if(OLD_RULES.includes(cfg.rules)){delete cfg.rules;}
function parseRules(){return(cfg.rules??DEFAULT_RULES).split('\n').map(l=>l.trim()).filter(l=>l&&l.includes('=')).map(l=>{const[lhs,rhs]=l.split('=');const[br,kw]=lhs.split(':');
  return{brands:(br||'').split(',').map(x=>normN(x)).filter(Boolean),kw:(kw||'').split('|').map(x=>x.trim().toLowerCase()).filter(Boolean),pre:(rhs||'').split(',').map(x=>normN(x)).filter(Boolean)};}).filter(r=>r.brands.length&&r.pre.length);}
const OEM_FAMILY={nissan:[[/rocker|valve cover|cam cover/i,/gasket/i,['13270']],[/oil filter/i,null,['15208']],[/air filter|air cleaner/i,null,['16546']],[/spark plug/i,null,['22401']],[/fuel filter/i,null,['16400','16403','16901']]],
toyota:[[/valve cover|rocker|cam cover|head cover/i,/gasket/i,['11213']],[/oil filter/i,null,['90915','04152']],[/air filter|air cleaner/i,null,['17801']],[/spark plug/i,null,['90919','90080']],[/cabin|pollen|a\/c filter/i,null,['87139','88568','88880']]],
lexus:'toyota',infiniti:'nissan'};
function makeKey(){const m=(st.vehicle?.make||st.vehicle?.vehicle||'').toLowerCase();for(const k of Object.keys(OEM_FAMILY))if(m.includes(k))return typeof OEM_FAMILY[k]==='string'?OEM_FAMILY[k]:k;return null;}
function oemOK(p,num){const k=makeKey();if(!k)return true;const n=normN(num);
  if(!/^\d{5}[A-Z0-9]{5}$/.test(n))return false;
  for(const[re,re2,fams]of OEM_FAMILY[k]){if(re.test(p.name||'')&&(!re2||re2.test(p.name||'')))return fams.some(f=>n.startsWith(f));}
  return true;}
function seqDigits(n){const d=(n.match(/\d+/g)||[]).join('');for(let i=0;i+4<=d.length;i++){const w=d.slice(i,i+4);let up=true,dn=true,same=true;for(let k=1;k<4;k++){const a=+w[k-1],b=+w[k];if((a+1)%10!==b)up=false;if((a+9)%10!==b)dn=false;if(a!==b)same=false;}if(up||dn||same)return true;}return /0000/.test(d);}
const looksFake=num=>{const n=normN(num);return n.length<4||seqDigits(n)||/(000|001)$/.test(n)&&!/^\d{5}[A-Z0-9]{5}$/.test(n)||/(XXX|ABC|123456|EXAMPLE|SAMPLE)/.test(n);};
function ruleWhy(p,brand,num){const b=normN(brand),n=normN(num),name=(p.name||'').toLowerCase();
  const rs=parseRules().filter(r=>!b?false:r.brands.some(x=>b===x||b.startsWith(x)));const rsAny=b?rs:parseRules();
  const km=r=>!r.kw.length||r.kw.some(k=>name.includes(k)),pm=r=>r.pre.some(x=>n.startsWith(x));
  if(rsAny.some(r=>km(r)&&pm(r)))return null;
  const fwd=rs.find(r=>r.kw.length&&km(r)&&!pm(r));if(fwd)return `${brand} ${fwd.kw[0]} numbers start with ${fwd.pre.join(' or ')}`;
  const rev=rsAny.filter(r=>r.kw.length&&pm(r)&&!km(r)).sort((x,y)=>Math.max(...y.pre.map(z=>z.length))-Math.max(...x.pre.map(z=>z.length)))[0];
  if(rev)return `${rev.pre.join('/')} numbers are ${rev.kw[0]}s, not ${p.name||'this part'}`;
  return null;}
const ruleOK=(p,b,n)=>!ruleWhy(p,b,n);
function ruleText(){const rs=(cfg.rules??DEFAULT_RULES).split('\n').filter(l=>l.includes('='));return rs.length?`NUMBER FORMAT RULES (each prefix is reserved for that part type and those parts use that prefix; numbers that break these are rejected): ${rs.join('; ')}. For example RC numbers are rocker/valve cover gaskets, never head gaskets.`:'';}
/* ---------- prompts ---------- */
function ctxLine(){const v=st.vehicle,e=st.engine;return `Vehicle: ${v.vehicle}${v.market?` (${v.market} market)`:''}${v.vinStr?`. VIN: ${v.vinStr}`:''}${v.rego?`. Rego: ${v.rego}`:''}. Engine: ${e?.label||'unknown'}${e?.code?` [${e.code}]`:''}.`;}
function ctx(){return ctxLine()+` Known engine data: ${JSON.stringify(st.spec?.engine||{})}`;}
function idPrompt(q,hint,facts){return `You are an automotive data expert at an Australian parts counter. Identify the vehicle described below and list its factory engine options.
Input: "${q}"${facts?`\nFacts decoded from the VIN by fixed rules (these are correct; do not contradict them, and never guess the model from VIN characters): ${facts}`:''}${hint?`\nEngine hint from the user: "${hint}"`:''}
The user is in Australia: prefer the Australian-market (ADM) spec when models differ by market, but list every engine that plausibly matches.
If the input contains a 17-character VIN, decode it as far as you reliably can (maker, model year character, plant, model and engine where the maker encodes it). If an engine hint is given and matches an option, list it first.
Return ONLY JSON:
{"found":true,"make":"","model":"","year":"","trim":"","series":"chassis/series code e.g. B01, GUN126R","market":"","vehicle":"Year Make Model Trim","vin":null,
"engines":[{"id":"e1","label":"short label, e.g. 2.8L turbo-diesel I4 (1GD-FTV)","code":"engine code or null","fuel":"petrol|diesel|hybrid|electric|lpg","years":"","notes":"one short line"}],
"message":"short note if ambiguous, otherwise empty"}
For a VIN set "vin" to {"decoded":"one-line summary","confidence":"high|medium|low"}. If you cannot identify the vehicle, set found false and explain in message. At most 8 engines.`;}
function specPrompt(){return `Give in-depth technical data for this engine as fitted to this vehicle.
${ctxLine()}
Be accurate. If unsure of a value use null rather than guessing, and list unsure items in "uncertain". Metric units.
Return ONLY JSON:
{"overview":"2-3 sentences: engine family, character, reputation",
"engine":{"name":"","code":"","manufacturer":"","family":"","layout":"inline|V|flat|rotary|electric","cylinders":4,"vAngle":null,"displacement_cc":0,"bore_mm":0,"stroke_mm":0,"compression":"","valvetrain":"DOHC|SOHC|OHV|none","valvesPerCyl":4,"variableValveTiming":"","aspiration":"NA|turbo|twin-turbo|supercharged|electric","fuel":"","injection":"direct|port|dual|common-rail|none","timingDrive":"belt|chain|gear|none","interference":"yes|no|null","firingOrder":"","power":"kW @ rpm","torque":"Nm @ rpm","redline_rpm":0,"blockMaterial":"","headMaterial":"","ignition":"","emissions":"","weight_kg":null},
"fluids":[{"item":"","spec":"","capacity":""}],"service":[{"item":"","interval":"","notes":""}],"torque":[{"item":"","value":"","notes":""}],
"knownIssues":[{"title":"","detail":"","severity":"low|medium|high"}],
"components":{"block":"","head":"","piston":"","conrod":"","crank":"","camshaft":"","valves":"","timing":"","sparkplug":"","injector":"","intake":"","exhaust":"","turbo":"","oil":"","cooling":"","accessory":"","sensors":"","gaskets":""},
"uncertain":[""]}
"components": 1-2 sentences per part SPECIFIC to this engine. Use "glowplug" not "sparkplug" for diesels; omit "turbo" if naturally aspirated; add "rotor" for rotaries. For EVs use layout "electric", cylinders 0 and components battery, inverter, motor, reducer, cooling. Include all fluids with capacities, 5-10 service items, 6-12 torque specs only where confident (include head-bolt angle procedure), 3-8 known issues.`;}
function partsPrompt(query,cat,grounded){return `You are an experienced parts interpreter at an Australian parts store (think Repco, Burson, Supercheap trade counter).
${ctxLine()}
${cat?`Category requested: ${cat}`:`Customer's search: "${query}"`}
Read abbreviations and trade slang the way a parts interpreter would (e.g. LCA = lower control arm, W/B = wiper blade, H7 = headlight globe type, "15A" = fuse rating, "rocker cover" = valve cover). This covers the WHOLE vehicle, not just the engine.
${cat?'List the matching parts fitted to this vehicle (up to 15, most commonly needed first).':'List ONLY parts that match the search, as fitted to this exact vehicle and engine (usually 1-5 items). Do not pad the list with related parts.'} List positions separately (front/rear, LH/RH; in Australia RH is the driver side) when part numbers or sizes differ.
${grounded?`USE GOOGLE SEARCH FIRST. Search for this part for this exact vehicle/engine on catalogue and retailer sites (repco.com.au, ryco.com.au, permaseal, bendix.com.au, protex, ngk.com.au, narva.com.au, burson.com.au, sparesbox.com.au, partsouq.com, amayama.com, megazip.net, the maker's genuine parts sites, forums for the engine code). ONLY output part numbers that you actually saw in search results for this vehicle or engine, and give the URL where you saw each one in "source". If you found no number, leave it out. A number without a source will be hidden from the customer.`:'Include a number ONLY if you have actually seen it listed for this vehicle; never guess or construct numbers. An empty list is better than a wrong number.'}
For every part give:
- "oem": genuine part numbers as an array of {"number":"","source":"URL or null"}. Find these ONLY on genuine parts catalogues (search with site:partsouq.com, site:amayama.com, site:megazip.net, or the maker's own parts site) for this exact model/engine; give that catalogue page as source. Numbers from forums or retailers don't count as genuine.
- "specs": the details a counter person checks, as key-value pairs, ONLY values you saw in a source or that are standard for this exact part (never estimate dimensions or bolt counts). E.g. thread size and pitch, length, diameter, hole size, globe type/base/wattage/voltage, fuse rating/type/position, wiper length in mm and inches plus connector, capacity, CCA, viscosity, material, dimensions.
- "crossRefs": aftermarket equivalents sold in Australia, as {"brand","number","store":"e.g. Repco / Burson / Supercheap","source":"URL or null","notes"}.
${repcoPromptLine()}
NEVER invent or pattern-fill a part number. Every number is checked against the search results and a published catalogue; numbers that can't be found are thrown away and counted against you. If you didn't see a number in a search result, leave it out and say so in notes.
BRAND RULES: only list a brand for products that brand actually makes. Ryco and Wesfil = filters only. Permaseal and Felpro = gaskets and seals. Bendix, Protex, DBA and RDA = brakes. NGK and Denso = spark plugs, glow plugs, ignition and oxygen sensors. Narva, Projecta, Philips and Osram = globes, fuses and electrical. Gates and Dayco = belts, hoses, tensioners. If no listed brand makes this part, give whichever real brand does, or none.
${brandRule()}
Return ONLY JSON:
{"interpreted":"one line on how you read the request","items":[{"name":"","position":"","oem":[{"number":"","source":null}],"specs":{},"qty":"","crossRefs":[],"notes":"","confidence":"high|medium|low"}],"tips":"optional short note, e.g. check build date or VIN for a split"}`;}
function xrefPrompt(num,veh,facts,grounded){return `You are an expert parts interpreter in Australia. Cross-reference this part number.
Part number: "${num}"${veh?`\nVehicle context: ${veh}`:''}${facts?`\nKNOWN FACTS (do not contradict): ${facts}`:''}
${grounded?'Search Google for this exact number first. Only describe the part and list cross-references you actually find in search results. If you cannot find this number, say so in "warning" and leave crossRefs empty; do NOT guess what it is from its digits.':'If you are not certain what this number is, say so in "warning" and leave crossRefs empty.'}
Never make up a cross-reference by reusing the digits of the searched number with another brand prefix.
Work out what the part is and which brand the number belongs to (a car maker's genuine number, or an aftermarket brand such as Ryco, Wesfil, Narva, OEX, NGK, Bendix). Then give cross-references:
- Other genuine numbers (supersessions or the same part from sister brands).
- Aftermarket equivalents stocked in Australia, e.g. OEM > Ryco/Wesfil/Sakura for filters, OEM > Narva/Philips/OEX for globes and electrical, OEM > Bendix/DBA/RDA for brakes, OEM > NGK/Denso/Bosch for plugs.
${brandRule()}
${liveOn()?'Use web search to confirm the numbers on retailer and manufacturer sites. ':''}Only include numbers you are confident of; leave out rather than guess.
Return ONLY JSON:
{"number":"","brand":"","type":"OEM|aftermarket","part":"what it is","specs":{},"fits":["vehicles it fits"],"crossRefs":[{"brand":"","number":"","kind":"OEM supersession|OEM alternative|aftermarket equivalent","store":"","notes":"","confidence":"high|medium|low"}],"warning":"anything to check, e.g. confirm by VIN","confidence":"high|medium|low"}`;}
function listingPrompt(p){const nums=[...(p.oem||[]),...(p.crossRefs||[]).map(c=>`${c.brand} ${c.number}`)].join(', ');return `Find real product listings on Australian retailer websites for this car part.
${ctxLine()}
Part: ${p.name}${p.position?` (${p.position})`:''}. Known numbers: ${nums||'none'}.
Use web search on sites such as repco.com.au, supercheapauto.com.au, autobarn.com.au, burson.com.au, sparesbox.com.au, autopro.com.au and ebay.com.au. Prefer listings that match the part numbers.
Return ONLY JSON: {"listings":[{"store":"","title":"","partNumber":"","price":"","url":""}],"note":"short note"}
Only include URLs you actually saw in search results. Never make up a URL.`;}

/* ---------- find tabs ---------- */
$$('#findTabs button').forEach(b=>b.onclick=()=>{$$('#findTabs button').forEach(x=>x.classList.toggle('on',x===b));$$('.fpane').forEach(p=>p.hidden=p.dataset.t!==b.dataset.t);});
const isVin=q=>/^[A-HJ-NPR-Z0-9]{17}$/i.test(q.replace(/\s/g,''));
$('#fVeh').addEventListener('submit',ev=>{ev.preventDefault();const q=$('#q').value.trim();if(q)runSearch(q,$('#hint').value.trim());});
$('#fVin').addEventListener('submit',ev=>{ev.preventDefault();const v=$('#vin').value.replace(/\s/g,'').toUpperCase();if(!isVin(v)){$('#vinMsg').textContent='A VIN is 17 letters and numbers (never I, O or Q).';return;}$('#vinMsg').textContent='';runSearch(v,'');});
$('#vin').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase();$('#vinCount').textContent=e.target.value.replace(/\s/g,'').length+'/17';});

/* ---------- rego ---------- */
const REGO={QLD:'https://www.service.transport.qld.gov.au/checkrego/public/Welcome.xhtml',NSW:'https://www.service.nsw.gov.au/transaction/check-a-vehicle-registration',VIC:'https://www.vicroads.vic.gov.au/registration',WA:'https://www.transport.wa.gov.au',SA:'https://www.sa.gov.au/topics/driving-and-transport/registration',TAS:'https://www.ppsr.gov.au/vehicle-registration-number',ACT:'https://www.ppsr.gov.au/vehicle-registration-number',NT:'https://www.ppsr.gov.au/vehicle-registration-number'};
function findVin(o){if(typeof o==='string')return /^[A-HJ-NPR-Z0-9]{17}$/.test(o)?o:'';if(o&&typeof o==='object'){for(const v of Object.values(o)){const r=findVin(v);if(r)return r;}}return'';}
function regoManual(state,plate,why){const out=$('#regoOut');
  out.innerHTML=`${why?`<div class="errbox">${esc(why)}</div>`:''}
<ol class="steps">
<li><b>Open the free ${state} rego check.</b> Your plate <code>${esc(plate)}</code> is copied, so just paste it in.<div class="row" style="margin-top:6px"><a class="btn sm primary" id="regoOpen" href="${REGO[state]}" target="_blank" rel="noopener">Open ${state} rego check \u2197</a></div></li>
<li><b>Copy the VIN</b> from the result, or the year, make and model if it doesn't show the VIN.</li>
<li><b>Paste it here.</b><div class="row" style="margin-top:6px"><input id="regoVin" type="text" placeholder="VIN, or e.g. 2022 Haval H6 Ultra"><button class="btn" id="regoPaste" type="button">Paste</button><button class="btn primary" id="regoVinGo" type="button">Go</button></div></li>
</ol>
<p class="small muted">The VIN is also printed on your rego papers, at the base of the windscreen and on the driver-side door pillar.</p>`;
  const go=()=>{const v=$('#regoVin').value.trim();if(!v){$('#regoVin').focus();return;}const vv=v.replace(/\s/g,'').toUpperCase();
    if(isVin(vv))runSearch(vv,'',{rego:`${plate} ${state}`});else runSearch(v,'',{rego:`${plate} ${state}`});};
  $('#regoVinGo').onclick=go;$('#regoVin').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go();}};
  $('#regoPaste').onclick=async()=>{try{const t=(await navigator.clipboard.readText()).trim();if(t){$('#regoVin').value=t;}}catch(e){$('#regoVin').focus();$('#regoPaste').textContent='Long-press to paste';}};
  try{navigator.clipboard.writeText(plate).catch(()=>{});}catch(e){}}
$('#fRego').addEventListener('submit',async ev=>{ev.preventDefault();const state=$('#state').value,plate=$('#plate').value.replace(/\s/g,'').toUpperCase();if(!plate)return;
  if(!cfg.regcheck){regoManual(state,plate);return;}
  $('#regoOut').innerHTML=skel(`Looking up ${plate} (${state})…`);
  try{const r=await fetch(`https://www.carregistrationapi.com.au/api/reg.asmx/CheckAustralia?RegistrationNumber=${qv(plate)}&State=${qv(state)}&username=${qv(cfg.regcheck)}`);const t=await r.text();
    const m=t.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/i);let desc='',vin='';
    if(m){const raw=m[1].replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');try{const j=JSON.parse(raw);desc=j.Description||'';vin=findVin(j);}catch(e){}}
    if(!vin)vin=(t.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)||[])[0]||'';
    if(!desc&&!vin)throw new Error(r.ok?'No vehicle found for that plate.':'The service answered '+r.status+'.');
    $('#regoOut').innerHTML=`<p class="small">Found <b>${esc(desc||'vehicle')}</b>${vin?` · VIN <code>${esc(vin)}</code>`:''}</p>`;
    runSearch(vin?`${desc} (VIN ${vin})`:desc,'',{rego:`${plate} ${state}`,vin});}
  catch(e){regoManual(state,plate,'Automatic lookup didn’t work, so here’s the free way.');}});

/* ---------- part-number cross reference ---------- */
$('#fPn').addEventListener('submit',ev=>{ev.preventDefault();const n=$('#pn').value.trim();if(n)xref(n,$('#pnVeh').value.trim(),$('#pnOut'));});
function kv(o){if(!o||typeof o!=='object')return'';const e=Array.isArray(o)?o.map((v,i)=>[i,v]):Object.entries(o);const c=e.filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`<span class="kv">${typeof k==='number'?'':`<i>${esc(k)}</i> `}${esc(typeof v==='object'?JSON.stringify(v):v)}</span>`).join('');return c?`<div class="kvs">${c}</div>`:'';}
const conf=c=>c?`<span class="conf c-${esc(c)}">${esc(c)}</span>`:'';
function prefixHint(num){const n=normN(num);let best=0,hits=[];parseRules().forEach(r=>{if(!r.kw.length)return;const L=Math.max(0,...r.pre.filter(x=>n.startsWith(x)&&n.length>x.length).map(x=>x.length));if(!L)return;if(L>best){best=L;hits=[];}if(L===best)hits.push(`${r.brands.map(b=>b[0]+b.slice(1).toLowerCase()).join('/')} ${r.kw[0]}`);});return hits;}
async function xref(num,veh,el){el.innerHTML=skel(`Cross-referencing ${num}…`);
  const local=allRepcoItems().filter(i=>normN(i.number)===normN(num));const gloc=allGenuineItems().filter(i=>normN(i.number)===normN(num));const hint=prefixHint(num);
  const nm=i=>{const b=i.brand.toLowerCase();let n=i.name;if(n.toLowerCase().startsWith(b))n=n.slice(b.length).trim();return `${i.brand} ${n}`;};
  const facts=[local.length?`Repco sells ${num} as "${nm(local[0])}" (price $${local[0].price}). This is a fact.`:'',gloc.length?`A genuine parts catalogue lists ${num} as "${gloc[0].name}" (${gloc[0].cat}${gloc[0].vin?', VIN '+gloc[0].vin:''}). This is a fact.`:'',hint.length?`The number format matches: ${hint.join(' or ')}.`:''].filter(Boolean).join(' ');
  const grounded=canVerify();const meta={};
  try{let r=await ask(xrefPrompt(num,veh,facts,grounded),{json:true,web:grounded,meta,tier:grounded?'default':'parts'});
    r=checkXref(r,num,meta,local,hint);if(gloc.length&&!local.length){r.part=gloc[0].name||r.part;r.brand='Genuine';r.type='OEM';r.identified='genuine';r.specs={};}else if(!local.length&&genuineFor(meta,num)){r.identified='genuinecat';r.gsrc=genuineFor(meta,num);}el.innerHTML=xrefHTML(r,local);st.lastXref={r,num,local};}
  catch(e){el.innerHTML=(local.length?xrefLocalHTML(local):'')+errBox(e);}}
function checkXref(r,num,meta,local,hint){r=r||{};r.number=r.number||num;const sup=normN(meta.supported||'');const qd=(normN(num).match(/\d+/g)||[]).join('');
  if(local.length){r.part=`${cap(local[0].name)}`;r.brand=local[0].brand;r.type='aftermarket';r.fromRepco=true;r.specs={};r.fits=[];}
  r.identified=local.length?'repco':(sup&&sup.includes(normN(num)))?'web':'guess';
  const p={name:r.part||hint[0]||''};r.rejected=[];
  r.crossRefs=(r.crossRefs||[]).filter(c=>{if(!c||!c.number)return false;const n=normN(c.number),d=(n.match(/\d+/g)||[]).join('');
    let why=null;if(!scopeOK(c.brand,p))why=`${c.brand} doesn’t make ${p.name||'this part'}`;else if(qd.length>=3&&d===qd&&n!==normN(num))why='just copies the digits of the number you searched';else if(looksFake(c.number))why='looks like a placeholder';else{const w=ruleWhy(p,c.brand,c.number);if(w)why=w;}
    if(why){r.rejected.push({brand:c.brand,number:c.number,why});return false;}
    const g=genuineFor(meta,c.number);c.vs=g?'confirmed':(/OEM/i.test(c.kind||'')?(/^https?:/.test(c.source||'')?'claimed':'unconfirmed'):(sup&&n.length>=4&&sup.includes(n)?'confirmed':/^https?:/.test(c.source||'')?'claimed':'unconfirmed'));if(g)c.gsrc=g;return true;});
  r.sources=meta.sources||[];return r;}
function xrefLocalHTML(local){const i=local[0];return `<div class="repco-box"><b>✓ Repco listing</b> <span class="small muted">(from your imported pages)</span><div class="ritem"><span><b>${esc(i.brand)}</b> <code>${esc(i.number)}</code> ${esc(cap(i.name))}</span><span class="small">${i.price?'$'+(+i.price).toFixed(2):''} ${lnk(i.url,'Repco ↗')}</span></div>${local.filter(x=>x.vehicle&&x.fits!=='unknown').map(x=>`<div class="small">${x.fits==='yes'?'✓ Fits':'✗ Doesn’t fit'} ${esc(x.vehicle)}</div>`).join('')}</div>`;}
function xrefHTML(r,local){const all=(r.crossRefs||[]).sort((x,y)=>(y.vs==='confirmed')-(x.vs==='confirmed')||isPref(y.brand)-isPref(x.brand));
  const refs=st.showUnvX?all:all.filter(c=>c.vs==='confirmed');const hid=all.length-refs.length;
  const idLab=r.identified==='genuine'?'<span class="vb repco">✓ Genuine (your import)</span>':r.identified==='genuinecat'?`<span class="vb ok">✓ Genuine catalogue</span> ${lnk(r.gsrc.uri,esc(r.gsrc.domain))}`:r.identified==='repco'?'<span class="vb repco">✓ Repco listing</span>':r.identified==='web'?'<span class="vb ok">✓ found online</span>':'<span class="vb unk">AI’s guess, unverified</span>';
  return `${local&&local.length?xrefLocalHTML(local):''}<div class="xcard"><div class="pn"><b>${esc(r.part||'Unknown part')}</b> ${idLab}</div>
<div class="small muted">${esc([r.brand,r.type].filter(Boolean).join(' · '))} · <code>${esc(r.number||'')}</code></div>${kv(r.specs)?`<div class="kvlab">AI notes, unverified</div>${kv(r.specs)}`:''}
${refs.length?`<table class="xt"><thead><tr><th>Brand</th><th>Number</th><th>Type</th><th>Find it</th></tr></thead><tbody>${refs.map(c=>`<tr${isPref(c.brand)?' class="pref"':''}><td>${esc(c.brand)}${isPref(c.brand)?` <span class="instore">${esc(cfg.store||'Repco')}</span>`:''}</td><td><code${c.vs!=='confirmed'?' class="dim"':''}>${esc(c.number)}</code> ${c.vs==='confirmed'?'<span class="vb ok">✓ verified</span>':c.vs==='claimed'?'<span class="vb fix">⚠ check source</span>':'<span class="vb unk">? unverified</span>'}${c.notes?`<div class="small muted">${esc(c.notes)}</div>`:''}</td><td class="small">${esc(c.kind||'')}</td><td class="plinks col">${storeLinks(c.number,true)}</td></tr>`).join('')}</tbody></table>`:'<p class="muted small">No cross-references could be verified online.</p>'}
${hid?`<button class="linkbtn" data-xtog type="button">Show ${hid} unchecked suggestion${hid>1?'s':''}</button>`:st.showUnvX&&all.some(c=>c.vs!=='confirmed')?`<button class="linkbtn" data-xtog type="button">Hide unchecked suggestions</button>`:''}
${(r.rejected||[]).length?`<details class="more"><summary>${r.rejected.length} rejected by format checks</summary><ul class="srcs">${r.rejected.map(x=>`<li><code>${esc(x.number)}</code> ${esc(x.brand)}: ${esc(x.why)}</li>`).join('')}</ul></details>`:''}
${r.warning?`<p class="warn">⚠ ${esc(r.warning)}</p>`:''}<div class="plinks">Search the original number: ${storeLinks(r.number||'')}${lnk(`https://partsouq.com/en/search/all?q=${qv(r.number||'')}`,'Partsouq')}</div></div>`;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-xtog]');if(!b||!st.lastXref)return;st.showUnvX=!st.showUnvX;const box=b.closest('#pnOut, .pout');if(box)box.innerHTML=xrefHTML(st.lastXref.r,st.lastXref.local);});
/* ---------- vehicle search ---------- */
/* ---------- VIN decoding by rule (maker + year), plus the free NHTSA decoder ---------- */
const WMI={LGW:'Great Wall Motor (Haval / GWM / Tank / Ora)',LGX:'BYD',LC0:'BYD',LSJ:'MG (SAIC)',LVV:'Chery',LVT:'Chery',LRW:'Tesla (Shanghai)',LFV:'Volkswagen (FAW)',LSV:'Volkswagen (SAIC)',LB3:'Geely',L6T:'Geely',LYV:'Volvo (China)',LS5:'Changan',LVS:'Ford (China)',LVR:'Mazda (China)',
MR0:'Toyota (Thailand)',MR1:'Toyota (Thailand)',MR2:'Toyota (Thailand)',MHF:'Toyota (Indonesia)',MNB:'Ford (Thailand)',MPA:'Isuzu (Thailand)',MPB:'Ford (Thailand)',MMA:'Mitsubishi (Thailand)',MMB:'Mitsubishi (Thailand)',MMC:'Mitsubishi (Thailand)',MMT:'Mitsubishi (Thailand)',MM8:'Mazda (Thailand)',MM0:'Mazda (Thailand)',MNT:'Nissan (Thailand)',MRH:'Honda (Thailand)',MA3:'Suzuki (India)',MAL:'Hyundai (India)',MAJ:'Ford (India)',MBH:'Suzuki (India)',
JT:'Toyota (Japan)',JN:'Nissan (Japan)',JM:'Mazda (Japan)',JF:'Subaru',JH:'Honda (Japan)',JA:'Mitsubishi / Isuzu (Japan)',JMB:'Mitsubishi (Japan)',JMY:'Mitsubishi (Japan)',JS:'Suzuki (Japan)',JDA:'Daihatsu',JAL:'Isuzu (Japan)',JLS:'Lexus',JTH:'Lexus',JTJ:'Lexus',
'6T1':'Toyota (Australia)','6G1':'Holden (Australia)','6G2':'Holden (Australia)','6H8':'Holden (Australia)','6FP':'Ford (Australia)','6MM':'Mitsubishi (Australia)',
KMH:'Hyundai (Korea)',KMF:'Hyundai (Korea)',KNA:'Kia (Korea)',KNC:'Kia (Korea)',KND:'Kia (Korea)',KNE:'Kia (Korea)',KPT:'SsangYong / KGM',KMT:'Genesis',KL1:'Holden / GM Korea',KL3:'Holden / GM Korea',KLA:'Holden / Daewoo',
WBA:'BMW',WBS:'BMW M',WBY:'BMW i',WMW:'MINI',WDB:'Mercedes-Benz',WDD:'Mercedes-Benz',WDC:'Mercedes-Benz',W1K:'Mercedes-Benz',W1N:'Mercedes-Benz',W1V:'Mercedes-Benz Van',WAU:'Audi',WUA:'Audi Sport',WVW:'Volkswagen',WVG:'Volkswagen SUV',WV1:'Volkswagen Commercial',WV2:'Volkswagen Commercial',WP0:'Porsche',WP1:'Porsche SUV',WF0:'Ford (Germany)',W0L:'Opel / Holden',W0V:'Opel / Holden',TMB:'Skoda',VSS:'Seat / Cupra',VF1:'Renault',VF3:'Peugeot',VF7:'Citroen',VR3:'Peugeot',VNK:'Toyota (France)',SAL:'Land Rover',SAJ:'Jaguar',SCC:'Lotus',SJN:'Nissan (UK)',SB1:'Toyota (UK)',ZFA:'Fiat',ZAR:'Alfa Romeo',ZFF:'Ferrari',ZHW:'Lamborghini',YV1:'Volvo',YV4:'Volvo SUV',NMT:'Toyota (Turkey)',NM0:'Ford (Turkey)',U5Y:'Kia (Slovakia)',TMA:'Hyundai (Czech)',
'5YJ':'Tesla (USA)','7SA':'Tesla (USA)','1FT':'Ford (USA)','1FA':'Ford (USA)','1FM':'Ford (USA)','1GC':'Chevrolet (USA)','1G1':'Chevrolet (USA)','1C4':'Jeep / Chrysler (USA)','1C6':'RAM (USA)','3C6':'RAM (Mexico)','1J4':'Jeep (USA)','1J8':'Jeep (USA)','4T1':'Toyota (USA)','5TD':'Toyota (USA)','3VW':'Volkswagen (Mexico)','5N1':'Nissan (USA)'};
function vinMaker(v){return WMI[v.slice(0,3)]||WMI[v.slice(0,2)]||null;}
function vinYear(v){const c=v[9],L='ABCDEFGHJKLMNPRSTVWXY',now=new Date().getFullYear();let y=null;const i=L.indexOf(c);if(i>=0)y=2010+i;else if(/[1-9]/.test(c))y=2000+ +c;if(y&&y>now+1)y-=30;return y;}
async function nhtsa(v){try{const r=await gfetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?format=json`,{},8000);const j=await r.json();const x=(j.Results||[])[0]||{};
  const g=k=>(x[k]||'').trim();return{make:g('Make'),model:g('Model'),year:g('ModelYear'),trim:g('Trim'),series:g('Series'),disp:g('DisplacementL'),engine:g('EngineModel'),cyl:g('EngineCylinders'),fuel:g('FuelTypePrimary'),body:g('BodyClass')};}catch(e){return{};}}
async function vinFlow(v,hint,extra){const my=++st.ver;saveRecent(v,hint);$('#choose').hidden=true;$('#result').hidden=true;status('Decoding VIN…',true);
  const maker=vinMaker(v),year=vinYear(v),n=await nhtsa(v);if(my!==st.ver)return;
  const mk=n.make||maker,yr=n.year||year;
  const facts=[mk?`maker ${mk} (from the first 3 characters, "${v.slice(0,3)}")`:'',yr?`model year ${yr} (from the 10th character, "${v[9]}")`:'',n.model?`model ${n.model}${n.trim?' '+n.trim:''}${n.series?' '+n.series:''} (official NHTSA decode)`:'',n.disp?`engine ${n.disp} L${n.engine?' '+n.engine:''}${n.cyl?' '+n.cyl+'-cyl':''}`:''].filter(Boolean).join('; ');
  if(n.model){status('');return runSearch(`${yr} ${n.make} ${n.model} ${n.trim||''}`.trim(),hint,{...extra,vin:v,facts,noVinFlow:true});}
  if(hint&&/[a-z]/i.test(hint)){status('');return runSearch(`${yr||''} ${maker||''} ${hint}`.trim(),'',{...extra,vin:v,facts,noVinFlow:true});}
  status('');pickModel(v,mk,yr,facts,extra);}
async function pickModel(v,mk,yr,facts,extra){const c=$('#choose');c.hidden=false;
  $('#chooseTitle').textContent=`${yr||'Unknown year'} ${mk||'Unknown maker'}`;
  $('#chooseMsg').innerHTML=`From VIN <code>${esc(v)}</code>. A VIN reliably shows the maker and year, but for most cars sold in Australia the model is in a maker-only code. <b>Pick your model:</b>`;
  $('#engList').innerHTML=`<div class="row" style="grid-column:1/-1"><input id="pmIn" type="text" placeholder="Type the model, e.g. H6 Ultra"><button class="btn primary" id="pmGo" type="button">Go</button></div><div id="pmList" class="chips" style="grid-column:1/-1">${mk?skel('Listing models…'):''}</div>`;
  const go=m=>{if(!m)return;runSearch(`${yr||''} ${m}`.trim(),'',{...extra,vin:v,facts:facts+`; model ${m} (chosen by the owner)`,noVinFlow:true});};
  $('#pmGo').onclick=()=>go($('#pmIn').value.trim());$('#pmIn').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go($('#pmIn').value.trim());}};
  $('#pmIn').focus();if(!mk){$('#pmList').innerHTML='';return;}
  try{const r=await ask(`List the car and light-commercial models (with the brand name as sold) that ${mk} sold new in Australia around model year ${yr||'unknown'}. Include every sub-brand of this maker. Return ONLY JSON: {"models":["Brand Model",...]} with at most 24 entries, most popular first.`,{json:true,tier:'quick',maxTokens:2000});
    const ms=(r.models||[]).filter(x=>typeof x==='string').slice(0,24);
    $('#pmList').innerHTML=ms.length?ms.map(m=>`<button class="chip" type="button">${esc(m)}</button>`).join(''):'';$$('#pmList .chip').forEach(b=>b.onclick=()=>go(b.textContent));}
  catch(e){$('#pmList').innerHTML='';}}
async function runSearch(q,hint,extra={}){const qv0=q.replace(/\s/g,'').toUpperCase();if(!extra.noVinFlow&&isVin(qv0))return vinFlow(qv0,hint,extra);const my=++st.ver;saveRecent(q,hint);$('#choose').hidden=true;$('#result').hidden=true;status('Identifying vehicle…',true);
  try{const r=await ask(idPrompt(q,hint,extra.facts),{json:true,tier:'quick',maxTokens:4000});if(my!==st.ver)return;
    if(!r.found||!Array.isArray(r.engines)||!r.engines.length){status(esc(r.message||'Couldn’t identify that vehicle. Try adding the year, model or engine.'),false,true);return;}
    const vinM=(q.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)||[])[0];r.vinStr=(extra.vin||vinM||'').toUpperCase()||null;r.rego=extra.rego||null;
    st.vehicle=r;status('');renderChoices(r);if(r.engines.length===1)chooseEngine(r.engines[0]);}
  catch(e){if(my!==st.ver)return;status(errBox(e),false,true);}}
function renderChoices(r){$('#choose').hidden=false;$('#chooseTitle').textContent=r.engines.length>1?`${r.vehicle}: which engine?`:r.vehicle;
  $('#chooseMsg').textContent=[r.vinStr?`VIN ${r.vinStr}`:'',r.message||''].filter(Boolean).join(' · ');
  $('#engList').innerHTML=r.engines.map((e,i)=>`<button class="eng" data-i="${i}" type="button"><b>${esc(e.label)}</b><span>${esc([e.years,e.notes].filter(Boolean).join(' · '))}</span></button>`).join('');
  $$('#engList .eng').forEach(b=>b.onclick=()=>chooseEngine(r.engines[+b.dataset.i]));}
function chooseEngine(e){const my=++st.ver;st.engine=e;st.spec=null;st.sel=null;st.pcache={};
  $$('#engList .eng').forEach(b=>b.classList.toggle('on',st.vehicle.engines[+b.dataset.i]===e));
  const res=$('#result');res.hidden=false;res.classList.remove('manual');const v=st.vehicle;
  $('#rTitle').textContent=v.vehicle;$('#rMarket').textContent=[e.label,v.series,v.market].filter(Boolean).join(' · ');
  $('#rIds').innerHTML=[v.vinStr?`VIN <code>${esc(v.vinStr)}</code>`:'',v.rego?`Rego <code>${esc(v.rego)}</code>`:''].filter(Boolean).join(' · ');
  $('#rOverview').innerHTML='';
  $('#specs').innerHTML=skel('Loading specifications…');$('#uncertain').textContent='';$('#fluids').innerHTML=skel('Loading…');$('#service').innerHTML='';$('#torque').innerHTML='';$('#issues').innerHTML=skel('Loading…');$('#ans').innerHTML='';
  $('#psq').value='';$('#abbrHint').textContent='';renderCats();renderRepcoPanel();renderDiagrams();renderResources();$('#resWeb').innerHTML='';
  st.s=normSpec(guessFromLabel(e));renderDiagram();renderDetail();renderLinks();
  $('#result').scrollIntoView({behavior:'smooth',block:'start'});
  $('#presults').innerHTML='<p class="muted">Search for a part above, or tap a category.</p>';
  lazySpecs(my,e);
}
function lazySpecs(my,e){let started=false;const go=()=>{if(started||my!==st.ver)return;started=true;io.disconnect();loadSpecs(my,e);};
  const io=new IntersectionObserver(es=>{if(es.some(x=>x.isIntersecting))go();},{rootMargin:'200px'});['#sec-diagram','#sec-specs','#sec-service','#sec-issues'].forEach(q=>io.observe($(q)));}
function loadSpecs(my,e){
  ask(specPrompt(),{json:true,tier:'parts'}).then(r=>{if(my!==st.ver)return;st.spec=r;st.s=normSpec(Object.assign(guessFromLabel(e),r.engine||{}));renderSpec();renderDiagram();renderDetail();renderLinks();})
    .catch(err=>{if(my!==st.ver)return;$('#rOverview').innerHTML='';$('#specs').innerHTML=errBox(err);$('#fluids').innerHTML='';$('#issues').innerHTML='';});}

/* ---------- whole-car parts search ---------- */
function renderCats(active){$('#cats').innerHTML=CATS.map(([n],i)=>`<button class="cat ${active===n?'on':''}" data-i="${i}" type="button">${esc(n)}</button>`).join('');
  $$('#cats .cat').forEach(b=>b.onclick=()=>partSearch(null,CATS[+b.dataset.i]));}
$('#psq').addEventListener('input',e=>{const h=expandAbbr(e.target.value);$('#abbrHint').textContent=h.length?'Reading as: '+h.join(' · '):'';});
$('#psf').addEventListener('submit',ev=>{ev.preventDefault();const q=$('#psq').value.trim();if(q)partSearch(q);});
async function partSearch(query,cat){if(query&&/diagram|routing/i.test(query)){const m=DG_CATS.find(c=>c[2]&&c[2].test(query));dgCat=m?m[0]:'all';renderDiagrams();$('#sec-diagrams').scrollIntoView({behavior:'smooth'});if(/^\s*(belt|fuse|wiring)?\s*(routing\s*)?diagram\s*$/i.test(query.replace(/belt|fuse|wiring/i,'')))return;}if(!st.vehicle||st.vehicle.manual)return;const my=st.ver;const key=cat?'c:'+cat[0]:'q:'+query.toLowerCase();renderCats(cat?cat[0]:null);
  const el=$('#presults');const label=cat?cat[0]:`“${query}”`;
  if(st.pcache[key]){renderParts(st.pcache[key],label,key);return;}
  el.innerHTML=skel(`Searching the web for ${label} for ${vshort()}…`);
  try{const hints=query?expandAbbr(query):[];const grounded=canVerify();const meta={};const r=normalizeItems(await ask(partsPrompt(query?(query+(hints.length?` (${hints.join('; ')})`:'')):null,cat?`${cat[0]}: ${cat[1]}`:null,grounded),{json:true,tier:grounded?'default':'parts',web:grounded,meta,maxTokens:12000}),grounded,meta);attachRepco(r);r.sources=meta.sources||[];r.grounded=grounded;
    if(my!==st.ver)return;st.pcache[key]=r;r.label=label;renderParts(r,label,key);}
  catch(e){if(my!==st.ver)return;el.innerHTML=errBox(e);}}
const BRAND_SCOPE={trico:/wiper|blade|refill/i,goss:/sensor|switch|valve|pump|regulator|solenoid/i,drivetech4x4:/bearing|shock|seal|suspension|hub|bush|kit/i,clutchindustries:/clutch|flywheel|slave|master/i,payen:/gasket|seal|washer/i,acl:/gasket|seal|bearing|ring|piston|bush/i,aclengineparts:/gasket|seal|bearing|ring|piston|bush/i,ryco:/filter/i,wesfil:/filter/i,sakura:/filter/i,permaseal:/gasket|seal|o.?ring/i,felpro:/gasket|seal|o.?ring/i,bendix:/brake|pad|shoe|rotor|disc|drum|caliper|fluid/i,protex:/brake|pad|shoe|rotor|disc|drum|caliper|cylinder|hose/i,dba:/brake|rotor|disc|pad/i,rda:/brake|rotor|disc|drum|pad/i,ngk:/spark|glow|plug|ignition|lead|coil|oxygen|o2|lambda|sensor/i,narva:/\b(globes?|bulbs?|lamps?|lights?|fuses?|relays?|switch(es)?|horns?|wiring|led|beacons?|flashers?)\b/i,projecta:/\b(globes?|bulbs?|lamps?|lights?|fuses?|relays?|switch(es)?|horns?|wiring|led|batter(y|ies)|chargers?|jump)\b/i,gates:/belt|hose|tensioner|idler|pulley|water pump|timing/i,dayco:/belt|hose|tensioner|idler|pulley|water pump|timing/i};
function scopeOK(brand,p){const k=normN(brand).toLowerCase();const re=BRAND_SCOPE[k];if(!re)return true;return re.test(p.name||'');}
function normalizeItems(r,grounded,meta){const sup=normN(meta&&meta.supported||'');const hasSup=!!sup;(r.items||[]).forEach(p=>{if(!p)return;p.v=p.v||{};
  const oem=(Array.isArray(p.oem)?p.oem:p.oem?[p.oem]:[]).map(o=>typeof o==='string'?{number:o,source:null}:o).filter(o=>o&&o.number);
  p.rejected=[];
  oem.forEach(o=>{const w=ruleWhy(p,'',o.number);if(w){p.rejected.push({brand:'OEM',number:o.number,why:w});o.bad=true;return;}if(!oemOK(p,o.number)||looksFake(o.number))p.rejected.push({brand:'OEM',number:o.number,why:looksFake(o.number)?'looks like a placeholder':'not a valid genuine number for this part'});});
  const okOem=oem.filter(o=>!o.bad&&oemOK(p,o.number)&&!looksFake(o.number));p.oem=okOem.map(o=>o.number);
  p.crossRefs=(p.crossRefs||[]).filter(c=>{if(!c||!c.number)return false;if(!scopeOK(c.brand,p)){p.rejected.push({brand:c.brand,number:c.number,why:`${c.brand} doesn't make this part`});return false;}
    {const w=ruleWhy(p,c.brand,c.number);if(w){p.rejected.push({brand:c.brand,number:c.number,why:w});return false;}}
    if(looksFake(c.number)){p.rejected.push({brand:c.brand,number:c.number,why:'looks like a placeholder'});return false;}return true;});
  oem.splice(0,oem.length,...okOem);
  const judge=(num,src)=>{const n=normN(num);const url=/^https?:/.test(src||'');if(hasSup&&n.length>=4&&sup.includes(n))return'confirmed';return url?'claimed':'unconfirmed';};
  if(grounded){oem.forEach(o=>{const g=genuineFor(meta,o.number);p.v[normN(o.number)]=g?{status:'genuine',source:g.uri,domain:g.domain}:{status:judge(o.number,o.source)==='unconfirmed'?'unconfirmed':'claimed',source:o.source};});
    p.crossRefs.forEach(c=>{p.v[normN(c.number)]={status:judge(c.number,c.source),source:c.source};});
    p.vdone=true;const st2=Object.values(p.v).map(z=>z.status),good=st2.filter(z=>z==='confirmed'||z==='genuine').length+st2.filter(z=>z==='claimed').length*0.5;p.confidence=!st2.length?'low':good===st2.length?'high':good?'medium':'low';}});
  return r;}
function vCounts(items){const c={confirmed:0,corrected:0,unconfirmed:0,added:0,claimed:0,repco:0,genuine:0,import:0};items.forEach(p=>Object.values(p.v||{}).forEach(z=>c[z.status]=(c[z.status]||0)+1));return c;}
function renderParts(r,label,key){const items=(r.items||[]).filter(Boolean);r.items=items;st.pitems=items;st.pres=r;st.pkey=key;const el=$('#presults');
  if(!items.length){el.innerHTML=`<p class="muted">Nothing found for ${esc(label)}. Try another wording or a category.</p>`;return;}
  const c=vCounts(items),done=items.every(p=>p.vdone);
  const vbar=!canVerify()?`<p class="warn">Numbers below are unverified AI suggestions. Add a Gemini key in Settings to check them against the web.</p>`
    :r.verifying?`<div class="vbar">${skel('Checking numbers against Google: catalogues and AU retailers…')}</div>`
    :(c.confirmed+c.corrected+c.added+c.unconfirmed+c.claimed+c.repco+c.genuine+c.import)?`<div class="vbar"><b>Web check:</b> ${c.genuine+c.import?`<span class="vb ok">✓ ${c.genuine+c.import} genuine OEM</span> `:''}${c.repco?`<span class="vb repco">✓ ${c.repco} Repco fit</span> `:''}<span class="vb ok">✓ ${c.confirmed+c.added} verified</span> <span class="vb fix">⚠ ${c.claimed} check source</span>${c.corrected?` <span class="vb fix">✎ ${c.corrected} corrected</span>`:''} <span class="vb unk">? ${c.unconfirmed} unverified</span>${!done?' <button class="linkbtn" data-act="verifyall" type="button">Check the rest</button>':''}${(c.unconfirmed+c.claimed)?` <button class="linkbtn" data-act="togunv" type="button">${st.showUnv?'Hide':'Show'} ${c.unconfirmed+c.claimed} unchecked suggestion${c.unconfirmed+c.claimed>1?'s':''}</button>`:''}${r.vsummary?`<div class="small muted">${esc(r.vsummary)}</div>`:''}</div>`
    :`<div class="vbar"><button class="btn sm primary" data-act="verifyall" type="button">✓ Verify all numbers with Google</button> <span class="small muted">Checks each number against catalogues and AU retailers</span></div>`;
  el.innerHTML=`<div class="rhead"><div><b>${esc(label)}</b> <span class="muted small">${items.length} parts</span>${r.interpreted?`<div class="small muted">${esc(r.interpreted)}</div>`:''}</div><button class="btn sm" data-act="copyall" type="button">Copy all</button></div>
${vbar}${r.tips?`<p class="warn">ℹ ${esc(r.tips)}</p>`:''}${items.map(partHTML).join('')}
${(r.sources||[]).length?`<details class="more"><summary>Sources checked (${r.sources.length})</summary><ul class="srcs">${r.sources.map(s=>`<li>${lnk(s.uri,esc(s.title))}</li>`).join('')}</ul></details>`:''}`;
  if(canVerify()&&!r.autoVerified&&!done){r.autoVerified=true;runVerify(r,label,key,items.map((_,i)=>i).slice(0,12));}}
async function runVerify(r,label,key,idxs){if(!idxs.length)return;r.verifying=true;if(st.pkey===key)renderParts(r,label,key);
  try{await verifyItems(r,idxs);}catch(e){r.verifyErr=errMsg(e);}
  r.verifying=false;if(st.pkey===key){renderParts(r,label,key);if(r.verifyErr){$('#presults .rhead').insertAdjacentHTML('afterend',`<div class="errbox small">Web check failed: ${esc(r.verifyErr)}</div>`);r.verifyErr=null;}}}
const ICON={
filter:'<rect x="12" y="10" width="24" height="30" rx="4"/><rect x="12" y="6" width="24" height="6" rx="2"/><line x1="17" y1="18" x2="31" y2="18"/><line x1="17" y1="24" x2="31" y2="24"/><line x1="17" y1="30" x2="31" y2="30"/>',
panel:'<rect x="6" y="14" width="36" height="20" rx="3"/><path d="M10 18 v12 M15 18 v12 M20 18 v12 M25 18 v12 M30 18 v12 M35 18 v12"/>',
plug:'<rect x="21" y="4" width="6" height="10" rx="1"/><path d="M17 14 h14 v8 h-14z"/><rect x="19" y="22" width="10" height="12"/><line x1="24" y1="34" x2="24" y2="42"/><path d="M24 42 h5"/>',
globe:'<path d="M24 6 a11 11 0 0 1 7 19 v5 h-14 v-5 a11 11 0 0 1 7 -19z"/><rect x="18" y="30" width="12" height="8" rx="1"/><path d="M21 22 l3 -5 l3 5"/><line x1="24" y1="38" x2="24" y2="43"/>',
fuse:'<rect x="12" y="8" width="24" height="18" rx="3"/><rect x="15" y="26" width="5" height="14"/><rect x="28" y="26" width="5" height="14"/>',
relay:'<rect x="10" y="8" width="28" height="26" rx="3"/><path d="M14 34 v8 M22 34 v8 M30 34 v8 M36 34 v8"/>',
wiper:'<path d="M6 34 Q24 26 42 14"/><path d="M8 37 Q24 29 43 18" stroke-dasharray="2 2"/><circle cx="12" cy="32" r="2"/>',
clip:'<path d="M14 12 h20 v5 h-20z"/><path d="M20 17 v18 l4 6 l4 -6 v-18"/><path d="M20 24 l-3 3 M28 24 l3 3 M20 30 l-3 3 M28 30 l3 3"/>',
pad:'<path d="M8 30 Q24 10 40 30 v6 Q24 18 8 36z"/><path d="M10 34 Q24 22 38 34"/>',
rotor:'<circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="8"/><circle cx="24" cy="24" r="2"/><path d="M24 9 v3 M24 36 v3 M9 24 h3 M36 24 h3"/>',
shock:'<rect x="19" y="4" width="10" height="20" rx="2"/><line x1="24" y1="24" x2="24" y2="38"/><circle cx="24" cy="41" r="3"/><circle cx="24" cy="4" r="2"/>',
spring:'<polyline points="14,6 34,10 14,14 34,18 14,22 34,26 14,30 34,34 14,38 34,42"/>',
belt:'<circle cx="14" cy="30" r="8"/><circle cx="34" cy="16" r="6"/><path d="M8 26 L29 12 M20 35 L39 20"/>',
hose:'<path d="M8 12 Q8 36 24 36 Q40 36 40 12" stroke-width="7" opacity=".6"/><path d="M5 12 h7 M36 12 h7"/>',
battery:'<rect x="6" y="14" width="36" height="24" rx="2"/><rect x="11" y="9" width="6" height="5"/><rect x="31" y="9" width="6" height="5"/><path d="M12 24 h6 M15 21 v6 M30 24 h6"/>',
sensor:'<path d="M16 6 h16 l4 7 l-4 7 h-16 l-4 -7z"/><rect x="20" y="20" width="8" height="12"/><path d="M22 32 v10 M26 32 v10"/>',
gasket:'<rect x="6" y="12" width="36" height="24" rx="5"/><circle cx="17" cy="24" r="6"/><circle cx="31" cy="24" r="6"/>',
bearing:'<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="8"/><circle cx="24" cy="12.5" r="3"/><circle cx="24" cy="35.5" r="3"/><circle cx="12.5" cy="24" r="3"/><circle cx="35.5" cy="24" r="3"/>',
bolt:'<path d="M17 6 h14 l3 5 l-3 5 h-14 l-3 -5z"/><rect x="20" y="16" width="8" height="26"/><path d="M20 21 l8 3 M20 27 l8 3 M20 33 l8 3"/>',
arm:'<path d="M8 36 L24 14 L40 36"/><circle cx="24" cy="12" r="4"/><circle cx="8" cy="36" r="4"/><circle cx="40" cy="36" r="4"/>',
fluid:'<path d="M16 14 h16 v26 a3 3 0 0 1 -3 3 h-10 a3 3 0 0 1 -3 -3z"/><rect x="20" y="6" width="8" height="8"/><path d="M19 26 h10"/>',
mirror:'<path d="M8 12 h28 a6 6 0 0 1 6 6 v10 a6 6 0 0 1 -6 6 h-22 l-6 -10z"/><path d="M10 34 l-4 8"/>',
strut:'<rect x="8" y="20" width="22" height="8" rx="3"/><line x1="30" y1="24" x2="42" y2="24"/><circle cx="6" cy="24" r="2.5"/><circle cx="43" cy="24" r="2.5"/>',
gear:'<circle cx="24" cy="24" r="9"/><path d="M24 6 v6 M24 36 v6 M6 24 h6 M36 24 h6 M11 11 l4 4 M33 33 l4 4 M37 11 l-4 4 M11 37 l4 -4"/>'};
const ICON_RULES=[[/cabin|pollen/i,'panel'],[/air filter|air cleaner/i,'panel'],[/filter/i,'filter'],[/glow/i,'plug'],[/spark/i,'plug'],[/globe|bulb|lamp|light|led|hid|drl/i,'globe'],[/fuse/i,'fuse'],[/relay/i,'relay'],[/wiper|blade|refill/i,'wiper'],[/clip|rivet|fastener|retainer|push pin/i,'clip'],[/pad|shoe/i,'pad'],[/rotor|disc|drum/i,'rotor'],[/gas strut|bonnet strut|tailgate strut|boot strut|lift support/i,'strut'],[/shock|strut|damper/i,'shock'],[/spring/i,'spring'],[/belt|timing|chain|tensioner|idler|pulley/i,'belt'],[/hose|pipe/i,'hose'],[/batter/i,'battery'],[/sensor|switch|o2|oxygen|abs|tpms/i,'sensor'],[/gasket|seal|o-ring|washer/i,'gasket'],[/bearing|hub/i,'bearing'],[/nut|bolt|stud|screw|sump plug/i,'bolt'],[/arm|link|joint|tie rod|bush|rack end/i,'arm'],[/oil|coolant|fluid|atf|grease/i,'fluid'],[/mirror/i,'mirror']];
const iconFor=n=>{for(const[r,k]of ICON_RULES)if(r.test(n||''))return ICON[k];return ICON.gear;};
const normN=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function vstate(p,num){return p.v&&p.v[normN(num)];}
function numBadge(p,num){const v=vstate(p,num);if(!v)return'';const src=v.source&&/^https?:/.test(v.source)?lnk(v.source,'source'):'';
  if(v.status==='genuine')return `<span class="vb ok" title="This number appears on a genuine parts catalogue page">✓ Genuine catalogue</span>${v.source?lnk(v.source,esc(v.domain||'view page')):''}`;
  if(v.status==='import')return `<span class="vb repco" title="From a genuine catalogue page you imported">✓ Genuine (your import)</span>${v.source?lnk(v.source,'view'):''}`;
  if(v.status==='repco')return `<span class="vb repco" title="Confirmed fit in Repco's catalogue (your imported page)">✓ Repco fit</span>${v.source?lnk(v.source,'view'):''}`;
  if(v.status==='confirmed')return `<span class="vb ok" title="Confirmed by web search">✓ verified</span>${src}`;
  if(v.status==='corrected')return `<span class="vb fix">✎ corrected to <code>${esc(v.correct)}</code></span>${src}`;
  if(v.status==='added')return `<span class="vb ok">✓ found online</span>${src}`;
  if(v.status==='claimed')return `<span class="vb fix" title="The AI cited a page, but the number wasn't in Google's results. Open the source to check.">⚠ check source</span>${src}`;
  return `<span class="vb unk" title="No web evidence found">? unverified, may not exist</span>`;}
function photoQuery(p){const o=(p.oem||[])[0];const c=(p.crossRefs||[]).find(c=>c&&c.number);return o?`${o} ${p.name}`:c?`${c.brand} ${c.number}`:`${vshort()} ${p.name}`;}
const CATALOGS=[[/filter/i,[['Ryco filter finder','https://www.ryco.com.au/'],['Wesfil','https://www.wesfil.com.au/']]],
[/\b(globes?|bulbs?|lamps?|lights?|fuses?|relays?|led|hid|drl)\b/i,[['Narva vehicle lookup','https://www.narva.com.au/']]],
[/\b(spark|glow|ignition|coils?|oxygen|o2|lambda)\b/i,[['NGK part finder','https://ngk.com.au/']]],
[/\b(brakes?|pads?|shoes?|rotors?|discs?|drums?|calipers?)\b/i,[['Bendix pad finder','https://www.bendix.com.au/'],['Protex','https://www.protex.com.au/']]],
[/\bbatter(y|ies)\b/i,[['Century battery finder','https://www.centurybatteries.com.au/']]],
[/\b(wipers?|wiper blades?|refills?)\b/i,[['Bosch wiper finder','https://www.bosch.com.au/']]]];
function catalogLinks(p){const t=`${p.name} ${JSON.stringify(p.specs||{})}`;const out=[];CATALOGS.forEach(([re,ls])=>{if(re.test(t))ls.forEach(l=>out.push(l));});
  out.push(['Repco (enter your rego)',`https://www.repco.com.au/search?text=${qv(p.name)}`]);
  const v=st.vehicle?.vinStr;out.push([v?'Genuine catalogue (your VIN)':'Genuine catalogue (Partsouq)',v?`https://partsouq.com/en/search/all?q=${v}`:'https://partsouq.com/']);
  return `<div class="cats-official"><span class="small muted">Confirm in the official catalogue:</span> ${out.map(([n,u])=>lnk(u,n+' ↗')).join('')}</div>`;}
function hidden(p,n){const v=vstate(p,n);return!st.showUnv&&v&&(v.status==='unconfirmed'||v.status==='claimed');}
function hiddenOem(p,n){const v=vstate(p,n);return!st.showUnv&&!(v&&(v.status==='genuine'||v.status==='import'||v.status==='repco'));}
function partHTML(p,i){const oem=(Array.isArray(p.oem)?p.oem:p.oem?[p.oem]:[]).filter(Boolean);p.oem=oem;const isR=c=>vstate(p,c.number)?.status==='repco';const refs=(p.crossRefs||[]).filter(c=>c&&c.number).sort((x,y)=>(isR(y)-isR(x))||(isPref(y.brand)-isPref(x.brand)));
  const num=n=>{const v=vstate(p,n);return v&&v.status==='corrected'?`<code class="struck">${esc(n)}</code>`:v&&v.status==='unconfirmed'?`<code class="dim">${esc(n)}</code>`:`<code>${esc(n)}</code>`;};
  return `<div class="pcard" data-i="${i}"><div class="ptop"><a class="pthumb" href="https://www.google.com/search?tbm=isch&q=${qv(photoQuery(p))}" target="_blank" rel="noopener" title="See real photos"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconFor(p.name)}</svg><span>Photos ↗</span></a>
<div class="pmain">${''}<div class="pn"><b>${esc(p.name)}</b>${p.position?`<span class="pos">${esc(p.position)}</span>`:''}${p.qty?`<span class="qty">×${esc(p.qty)}</span>`:''}${conf(p.confidence)}</div>${kv(p.specs)?`<div class="kvlab">AI notes, unverified</div>${kv(p.specs)}`:''}</div></div>
<div class="nums"><div class="numrow"><span class="nlab">OEM</span>${oem.filter(n=>!hiddenOem(p,n)).length?oem.filter(n=>!hiddenOem(p,n)).map(n=>num(n)+numBadge(p,n)).join(' '):'<span class="muted small">no genuine-catalogue match found. Check by VIN in the genuine catalogue below.</span>'}${oem.filter(n=>!hiddenOem(p,n)).length?`<span class="plinks">${lnk(`https://partsouq.com/en/search/all?q=${qv(oem.filter(n=>!hiddenOem(p,n))[0])}`,'Partsouq')}${lnk(ebay(oem[0]),'eBay')}<button class="linkbtn" data-act="xref" data-n="${esc(oem[0])}" type="button">Cross-ref</button></span>`:''}</div>
${refs.filter(c=>!hidden(p,c.number)).map(c=>`<div class="numrow${isPref(c.brand)?' pref':''}"><span class="nlab">${esc(c.brand)}${isPref(c.brand)?`<span class="instore">${esc(cfg.store||'Repco')}</span>`:''}</span>${num(c.number)}${numBadge(p,c.number)}${c.store?`<span class="small muted">${esc(c.store)}</span>`:''}<span class="plinks">${storeLinks(vstate(p,c.number)?.status==='corrected'?vstate(p,c.number).correct:c.number,true)}</span>${c.notes?`<div class="small muted full">${esc(c.notes)}</div>`:''}</div>`).join('')}</div>
${(p.rejected||[]).length?`<details class="more"><summary>${p.rejected.length} number${p.rejected.length>1?'s':''} rejected by format checks</summary><ul class="srcs">${p.rejected.map(x=>`<li><code>${esc(x.number)}</code> ${esc(x.brand)}: ${esc(x.why)}</li>`).join('')}</ul></details>`:''}
${p.notes?`<div class="pnote">${esc(p.notes)}</div>`:''}
${catalogLinks(p)}<div class="plinks">Search stores: ${storeLinks(`${vshort()} ${p.position||''} ${p.name}`.replace(/\s+/g,' '))}</div>
<div class="pact">${canVerify()&&!p.vdone?`<button class="btn sm" data-act="verify1" type="button">Verify with Google</button>`:''}${liveOn()?`<button class="btn sm" data-act="live" type="button">Find live listings</button>`:''}<button class="btn sm ghost" data-act="copy" type="button">Copy</button></div><div class="pout"></div></div>`;}
const canVerify=()=>['gemini','api','groq'].includes(aiMode());
function verifyPrompt(list){return `You are checking a car parts list for accuracy using web search.
${ctxLine()}
For each item, search for its part numbers together with this vehicle on manufacturer catalogues and parts sites, e.g. repco.com.au, ryco.com.au, bendix.com.au, protex.com.au, permaseal.com.au, saas.com.au, wesfil.com.au, sakurafilters, ngk.com.au, narva.com.au, bendix.com.au, dba.com.au, repco.com.au, burson.com.au, supercheapauto.com.au, sparesbox.com.au, partsouq.com, amayama.com, megazip.net, and the car maker's genuine parts sites.
For every number decide:
- "confirmed": a source shows this number fits this vehicle (and position).
- "corrected": sources show a different number is right; put it in "correct".
- "unconfirmed": you found no evidence either way.
You may also add important numbers you find with status "added" (put the number in "correct").
Be strict: only mark confirmed or corrected when a search result actually supports it. Give the URL you relied on in "source".
Items: ${JSON.stringify(list)}
Return ONLY JSON: {"items":[{"i":0,"numbers":[{"brand":"OEM or brand name","number":"number as given (or null when added)","status":"confirmed|corrected|unconfirmed|added","correct":null,"source":null}]}],"summary":"one short line"}`;}
async function verifyItems(r,idxs,onDone){const list=idxs.map(i=>{const p=r.items[i];return{i,name:p.name,position:p.position||'',oem:p.oem||[],aftermarket:(p.crossRefs||[]).filter(c=>c&&c.number).map(c=>({brand:c.brand,number:c.number}))};});
  const meta={};const v=await ask(verifyPrompt(list),{json:true,web:true,meta,maxTokens:12000});
  (v.items||[]).forEach(x=>{const p=r.items[+x.i];if(!p)return;p.v=p.v||{};p.vdone=true;
    (x.numbers||[]).forEach(n=>{if(!n)return;if(n.status==='added'&&n.correct){const exists=[...(p.oem||[]),...(p.crossRefs||[]).map(c=>c.number)].some(z=>normN(z)===normN(n.correct));
        if(!exists){if(/^oem|genuine/i.test(n.brand||''))p.oem=[...(p.oem||[]),n.correct];else p.crossRefs=[...(p.crossRefs||[]),{brand:n.brand||'Found',number:n.correct}];}
        p.v[normN(n.correct)]={status:'added',source:n.source};return;}
      if(n.number){let stt=n.status||'unconfirmed';if((stt==='confirmed'||stt==='corrected')&&!/^https?:/.test(n.source||''))stt='unconfirmed';p.v[normN(n.number)]={status:stt,correct:n.correct,source:n.source};}});
    const st2=Object.values(p.v).map(z=>z.status);const good=st2.filter(z=>z!=='unconfirmed').length;p.confidence=!st2.length?p.confidence:good===st2.length?'high':good?'medium':'low';});
  idxs.forEach(i=>{if(r.items[i])r.items[i].vdone=true;});
  r.sources=[...(r.sources||[]),...(meta.sources||[])].filter((s,k,a)=>a.findIndex(t=>t.uri===s.uri)===k).slice(0,12);r.vsummary=v.summary||'';onDone&&onDone();}
const partText=p=>[`${p.name}${p.position?' ('+p.position+')':''}${p.qty?' x'+p.qty:''}`,p.oem?.filter(n=>!hidden(p,n)).length?`  OEM: ${p.oem.filter(n=>!hiddenOem(p,n)).join(', ')}`:'',...(p.crossRefs||[]).filter(c=>c.number&&!hidden(p,c.number)).map(c=>`  ${c.brand}: ${c.number}`),p.specs&&typeof p.specs==='object'?'  '+Object.entries(p.specs).map(([k,v])=>`${k}: ${v}`).join('; '):''].filter(Boolean).join('\n');
async function copyText(t,btn){const o=btn.textContent;try{await navigator.clipboard.writeText(t);btn.textContent='Copied';}catch(e){btn.textContent='Copy blocked';}setTimeout(()=>btn.textContent=o,1500);}
$('#presults').addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act;
  if(act==='copyall'){copyText(`${st.vehicle.vehicle}${st.vehicle.vinStr?' VIN '+st.vehicle.vinStr:''}\n\n`+st.pitems.map(partText).join('\n\n'),b);return;}
  if(act==='togunv'){st.showUnv=!st.showUnv;renderParts(st.pres,st.pres.label||'',st.pkey);return;}
  if(act==='verifyall'){const r=st.pres;runVerify(r,r.label||'',st.pkey,r.items.map((p,i)=>p.vdone?-1:i).filter(i=>i>=0).slice(0,12));return;}
  const card=b.closest('.pcard'),p=st.pitems[+card.dataset.i],out=card.querySelector('.pout');
  if(act==='verify1'){b.disabled=true;b.textContent='Checking…';const r=st.pres,key=st.pkey;try{await verifyItems(r,[+card.dataset.i]);}catch(err){out.innerHTML=errBox(err);b.disabled=false;b.textContent='Verify with Google';return;}if(st.pkey===key)renderParts(r,r.label||'',key);return;}
  if(act==='copy')copyText(`${vshort()}\n`+partText(p),b);
  else if(act==='xref')xref(b.dataset.n,ctxLine(),out);
  else if(act==='live'){b.disabled=true;out.innerHTML=skel('Searching Australian retailers…');
    try{const r=await ask(listingPrompt(p),{json:true,web:true});const ls=(r.listings||[]).filter(l=>l&&/^https?:\/\//.test(l.url||''));
      out.innerHTML=ls.length?`<div class="listings">${ls.map(l=>`<a class="lk" href="${esc(l.url)}" target="_blank" rel="noopener"><b>${esc(l.store)} ↗</b><span>${esc(l.title)}</span><span class="mono">${esc([l.partNumber,l.price].filter(Boolean).join(' · '))}</span></a>`).join('')}</div>${r.note?`<p class="small muted">${esc(r.note)}</p>`:''}`:`<p class="muted small">No listings found. ${esc(r.note||'')}</p>`;}
    catch(err){out.innerHTML=errBox(err);}b.disabled=false;}});

/* ---------- Import a saved Repco page (stays in this browser only) ---------- */
const RKEY='ps-repco';
function loadRepco(){try{return JSON.parse(localStorage.getItem(RKEY)||'[]')}catch(e){return[]}}
function saveRepco(a){try{localStorage.setItem(RKEY,JSON.stringify(a));}catch(e){alertBox('Couldn’t save: browser storage is full or blocked.');}}
const SKIPTOK=/^(\d+|\d+(mm|v|a|th|wd|in|inch|l)|4x4|4wd|suv|n95|cw|ccw)$/;
function slugInfo(url){const slug=(url.split('/p/')[0].split('/').pop()||'');const t=slug.split('-');let idx=-1;
  for(let k=t.length-1;k>=0;k--){if(/[a-z]/.test(t[k])&&/\d/.test(t[k])&&!SKIPTOK.test(t[k])){idx=k;break;}}
  let number=null,words=t;if(idx>=0){number=t[idx];if(t[idx+1]&&t[idx+1].length===1)number+='-'+t[idx+1];words=t.slice(0,idx);}
  return{number:number?number.toUpperCase():null,name:words.join(' ')};}
function parseRepcoHTML(txt,fname){const doc=new DOMParser().parseFromString(txt,'text/html');doc.querySelectorAll('script,style,svg').forEach(e=>e.remove());
  const body=(doc.body?.textContent||'').replace(/\s+/g,' ');
  const pdp=body.match(/This (does not fit|fits) your vehicle\s+(.{2,50}?)\s+Change Vehicle/i);
  const vm=body.match(/My Vehicles?\s+(?:My Vehicles\s+)?(.{3,60}?)\s+\+\s*Add/i);
  const vehicle=(pdp?pdp[2]:vm?vm[1]:'').trim();
  const canon=doc.querySelector('link[rel=canonical]')?.getAttribute('href')||'';const items=[];const seen=new Set();
  doc.querySelectorAll('[data-sku][data-url]').forEach(el=>{const sku=el.getAttribute('data-sku');if(seen.has(sku))return;seen.add(sku);
    const url=el.getAttribute('data-url')||'';const info=slugInfo(url);const cat=(url.split('/p/')[0].split('/').slice(-2,-1)[0]||'').replace(/-/g,' ');
    const fb=(el.querySelector('.fitment-bar')?.textContent||el.textContent||'');const fits=/Fits your vehicle/i.test(fb)||!!el.querySelector('.fitment-bar .fit')?'yes':/Doesn.t fit your vehicle/i.test(el.textContent||'')?'no':'unknown';
    items.push({sku,brand:el.getAttribute('data-brand')||'',number:info.number,name:info.name,cat,price:el.getAttribute('data-price')||'',fits,url:url.startsWith('http')?url:'https://www.repco.com.au'+url});});
  if(pdp&&canon){const info=slugInfo(canon);const sm=body.match(/SKU:\s*(A\d+)\s*\$([\d.,]+)/);const tm=body.match(/([A-Z][\w'&. ]+?) - ([A-Z0-9-]+)\s+SKU:/);
    const sku=sm?sm[1]:canon.split('/p/')[1]||canon;const brand=(tm?tm[1]:info.name).split(' ')[0];
    const main={sku,brand,number:info.number,name:info.name,cat:(canon.split('/p/')[0].split('/').slice(-2,-1)[0]||'').replace(/-/g,' '),price:sm?sm[2]:'',fits:/does not/i.test(pdp[1])?'no':'yes',url:canon,pdp:true};
    const i=items.findIndex(x=>x.sku===main.sku);if(i>=0)items[i]=main;else items.unshift(main);}
  return{vehicle,source:canon||fname,date:new Date().toISOString().slice(0,10),items,pdp:!!pdp};}
const OEMRX=/^(?=(?:.*\d){4})[A-Z0-9]{3,6}(?:[- ][A-Z0-9]{2,6}){1,2}$|^(?=(?:.*\d){5})[A-Z0-9]{8,14}$/;
function parseGenuineHTML(txt,fname){const doc=new DOMParser().parseFromString(txt,'text/html');doc.querySelectorAll('script,style,svg,noscript').forEach(e=>e.remove());
  const body=(doc.body?.textContent||'').replace(/\s+/g,' ');const saved=(txt.match(/saved from url=\(\d+\)(\S+)/)||[])[1]||'';
  const canon=doc.querySelector('link[rel=canonical]')?.getAttribute('href')||saved||fname;
  const vin=(body.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)||[])[0]||'';const h=(doc.querySelector('h1')?.textContent||doc.title||'').replace(/\s+/g,' ').trim();
  const group=(doc.querySelector('h2')?.textContent||h).replace(/\s+/g,' ').trim().slice(0,80);
  const items=[];const seen=new Set();const add=(num,name)=>{const n=num.trim().toUpperCase();if(!OEMRX.test(n)||seen.has(normN(n)))return;seen.add(normN(n));items.push({sku:n,brand:'Genuine',number:n,name:(name||'').replace(/\s+/g,' ').trim().slice(0,90),cat:group,fits:'yes',url:canon,genuine:true});};
  doc.querySelectorAll('tr').forEach(tr=>{const cells=[...tr.querySelectorAll('td,th')].map(c=>c.textContent.replace(/\s+/g,' ').trim());const numCell=cells.find(c=>OEMRX.test(c.toUpperCase()));if(!numCell)return;
    const name=cells.filter(c=>c!==numCell&&/[a-z]{3,}/i.test(c)&&!/^\d+([.,]\d+)?$/.test(c)).sort((a,b)=>b.length-a.length)[0]||'';add(numCell,name);});
  if(!items.length)doc.querySelectorAll('a').forEach(a=>{const t=a.textContent.replace(/\s+/g,' ').trim();if(OEMRX.test(t.toUpperCase())){const row=a.closest('li,div,tr');add(t,row?row.textContent.replace(t,''):'');}});
  const imgs=[...doc.querySelectorAll('img')].map(im=>({src:im.getAttribute('data-src')||im.getAttribute('data-original')||im.getAttribute('src')||'',w:+(im.getAttribute('width')||0),alt:im.getAttribute('alt')||''})).filter(x=>/^https?:/.test(x.src)&&!/logo|icon|flag|sprite|avatar|banner|pixel|badge|payment/i.test(x.src));
  const diag=imgs.filter(x=>/diagram|scheme|illustr|unit|group|image|picture|img/i.test(x.src)||x.w>=300).slice(0,3).map(x=>({src:x.src,title:group||h}));
  return{vehicle:h,vin,source:canon,date:new Date().toISOString().slice(0,10),items,genuine:true,diagrams:diag,localImgs:[...doc.querySelectorAll('img')].some(im=>/_files\//.test(im.getAttribute('src')||''))};}
function parseSavedImg(){}
function parseSaved(txt,fname){const head=(txt.slice(0,4000)+fname).toLowerCase();return /partsouq|amayama|megazip|7zap/.test(head)?parseGenuineHTML(txt,fname):parseRepcoHTML(txt,fname);}
function genuineForVehicle(){const v=st.vehicle;if(!v||v.manual)return[];const hay=`${v.vehicle} ${v.make||''} ${v.model||''}`.toLowerCase();const mk=(v.make||'').toLowerCase(),md=(v.model||'').toLowerCase().split(/\s+/)[0]||'';
  const out=[];loadRepco().filter(pg=>pg.genuine).forEach(pg=>{const lab=`${pg.vehicle} ${pg.source}`.toLowerCase();const ok=(v.vinStr&&pg.vin&&v.vinStr===pg.vin)||(mk&&md&&lab.includes(mk)&&lab.includes(md));if(ok)pg.items.forEach(it=>{if(!out.some(o=>o.number===it.number))out.push(it);});});return out;}
function allRepcoItems(){const out=[];loadRepco().filter(pg=>!pg.genuine).forEach(pg=>pg.items.forEach(it=>out.push({...it,vehicle:pg.vehicle})));return out;}
function allGenuineItems(){const out=[];loadRepco().filter(pg=>pg.genuine).forEach(pg=>pg.items.forEach(it=>out.push({...it,vehicle:pg.vehicle,vin:pg.vin})));return out;}
function vehMatch(label){const v=st.vehicle;if(!v||v.manual||!label)return false;const hay=`${v.vehicle} ${v.year||''} ${v.make||''} ${v.model||''}`.toLowerCase();const toks=label.toLowerCase().split(/\s+/).filter(t=>t.length>1);return toks.length>0&&toks.every(t=>hay.includes(t));}
function repcoForVehicle(state='yes'){const best={};allRepcoItems().forEach(it=>{if(it.fits==='unknown'||it.fits===undefined||!vehMatch(it.vehicle))return;const sp=(it.vehicle||'').split(/\s+/).length;const cur=best[it.sku];if(!cur||sp>cur.sp)best[it.sku]={...it,sp};});
  return Object.values(best).filter(i=>i.fits===state);}
const KEYW=['brake','front','rear','oil','air','cabin','fuel','filter','pad','pads','rotor','disc','caliper','wiper','blade','refill','water','pump','alternator','starter','radiator','belt','tensioner','sensor','knock','speed','headlight','clutch','bearing','shock','absorber','gasket','valve','suction','overflow','bottle','tank','kit','seal','spark','glow','plug','globe','battery','hose','thermostat','mount','link','joint'];
const DISTINCT=['alternator','starter','radiator','tensioner','clutch','headlight','caliper','rotor','absorber','thermostat','battery'];
function repcoMatches(p,list){const nw=(p.name||'').toLowerCase().split(/[^a-z]+/).filter(w=>KEYW.includes(w));if(!nw.length)return[];
  return list.filter(it=>{const iw=`${it.name} ${it.cat}`.toLowerCase().split(/[^a-z]+/);const shared=nw.filter(w=>iw.includes(w));
    const core=shared.filter(w=>w!=='front'&&w!=='rear');return core.length>=2||core.some(w=>DISTINCT.includes(w));});}
function attachRepco(r){const gl=genuineForVehicle();if(gl.length)(r.items||[]).forEach(p=>{const ms=repcoMatches(p,gl);if(!ms.length)return;p.v=p.v||{};ms.slice(0,4).forEach(it=>{if(!(p.oem||[]).some(n=>normN(n)===normN(it.number)))p.oem=[it.number,...(p.oem||[])];p.v[normN(it.number)]={status:'import',source:it.url};});p.confidence='high';});
  const list=repcoForVehicle('yes'),neg=repcoForVehicle('no');if(!list.length&&!neg.length)return r;r.repcoN=list.length;
  (r.items||[]).forEach(p=>{p.v=p.v||{};p.rejected=p.rejected||[];
    if(neg.length){const bad=new Set(neg.map(i=>normN(i.number)).filter(Boolean));
      p.oem=(p.oem||[]).filter(n=>{if(bad.has(normN(n))){p.rejected.push({brand:'OEM',number:n,why:'Repco says this doesn’t fit your vehicle'});return false;}return true;});
      p.crossRefs=(p.crossRefs||[]).filter(c=>{if(bad.has(normN(c.number))){p.rejected.push({brand:c.brand,number:c.number,why:'Repco says this doesn’t fit your vehicle'});return false;}return true;});}
    const ms=repcoMatches(p,list);if(!ms.length)return;
    ms.forEach(it=>{if(!it.number)return;const exists=(p.crossRefs||[]).find(c=>normN(c.number)===normN(it.number));
      if(!exists)p.crossRefs=[{brand:it.brand,number:it.number,store:'Repco',source:it.url,notes:`${cap(it.name)} · $${(+it.price).toFixed(2)}`},...(p.crossRefs||[])];
      p.v[normN(it.number)]={status:'repco',source:it.url};});
    p.confidence='high';p.repco=true;});return r;}
function repcoPromptLine(){const list=repcoForVehicle('yes').filter(i=>i.number).slice(0,45);const neg=repcoForVehicle('no').filter(i=>i.number).slice(0,20);if(!list.length&&!neg.length)return'';
  if(!list.length)return `REPCO SAYS THESE DO NOT FIT this vehicle (never suggest them): ${neg.map(i=>`${i.brand} ${i.number}`).join('; ')}.`;
  return `REPCO CATALOGUE FACTS for this vehicle (confirmed fitment, treat as ground truth and use these numbers where relevant): ${list.map(i=>`${i.brand} ${i.number} (${i.name})`).join('; ')}.${neg.length?` REPCO SAYS THESE DO NOT FIT (never suggest them): ${neg.map(i=>`${i.brand} ${i.number}`).join('; ')}.`:''}`;}
function renderRepcoPanel(){const el=$('#repcoPanel');if(!el)return;const list=repcoForVehicle('yes');const negN=repcoForVehicle('no').length;const pages=loadRepco();const gN=genuineForVehicle().length;const old=pages.some(pg=>pg.items.some(i=>i.fits===undefined));
  const groups={};list.forEach(i=>{(groups[i.cat||'other']=groups[i.cat||'other']||[]).push(i);});
  el.innerHTML=`${list.length?`<details class="repco-box"${list.length<=8?' open':''}><summary><b>✓ ${list.length} Repco-confirmed parts</b> for ${esc(list[0].vehicle)} <span class="small muted">(from pages you imported${negN?`; ${negN} marked doesn’t fit`:''})</span></summary>
${Object.entries(groups).map(([g,its])=>`<div class="rgrp"><div class="nlab">${esc(g)}</div>${its.map(i=>`<div class="ritem"><span><b>${esc(i.brand)}</b> ${i.number?`<code>${esc(i.number)}</code>`:''} <span class="small muted">${esc(cap(i.name))}</span></span><span class="small">${i.price?'$'+(+i.price).toFixed(2):''} ${lnk(i.url,'Repco ↗')}</span></div>`).join('')}</div>`).join('')}</details>`:''}
${old?'<p class="warn">Pages imported before this update need importing again so each product\u2019s own fit label is read.</p>':''}${gN?`<div class="repco-box" style="border-color:var(--ok)"><b>✓ ${gN} genuine OEM numbers</b> <span class="small muted">from genuine catalogue pages you imported for this vehicle. They appear in the OEM row of matching parts.</span></div>`:''}<div class="rimport"><label class="btn sm" for="repcoFile">📄 Import a saved Repco or Partsouq page</label><input id="repcoFile" type="file" accept=".html,.htm,text/html,image/*" multiple hidden>
<span class="small muted">${pages.length?`${pages.length} page${pages.length>1?'s':''} imported · <button class="linkbtn" id="repcoClear" type="button">clear</button>`:'Save a Repco page (with your car selected) or a Partsouq/Amayama catalogue page for your VIN, then import it here. It stays in this browser only.'}</span></div>`;
  $('#repcoFile').onchange=async e=>{const files=[...e.target.files];let added=0,msg=[];const pgs=loadRepco();
    for(const f of files){if(/^image\//.test(f.type)){try{if(!st.vehicle||st.vehicle.manual){msg.push('Open a vehicle first, then add its diagram photo');continue;}const img=await shrinkImg(f);pgs.push({diagramOnly:true,vehicle:st.vehicle.vehicle,vin:st.vehicle.vinStr||'',source:f.name,date:new Date().toISOString().slice(0,10),items:[],diagrams:[{src:img,title:f.name.replace(/\.[a-z]+$/i,'').replace(/[_-]+/g,' ')}]});added++;msg.push(`Diagram added: ${f.name}`);}catch(err){msg.push(`${f.name}: couldn\u2019t read that image`);}continue;}
      try{const pg=parseSaved(await f.text(),f.name);if(!pg.items.length&&!(pg.diagrams&&pg.diagrams.length)){msg.push(pg.genuine?(pg.localImgs?`${f.name}: saved as 'complete' so images are in a separate folder. Save as 'HTML only' or add the diagram image itself.`:''):'');if(msg[msg.length-1]){continue;}msg.pop();msg.push(pg.genuine?`${f.name}: couldn\u2019t find a parts table. Send the file to Claude to tune the reader`:`${f.name}: no products found`);continue;}
      const i=pgs.findIndex(x=>x.source===pg.source&&x.vehicle===pg.vehicle);if(i>=0)pgs[i]=pg;else pgs.push(pg);added+=pg.items.length;if(pg.genuine){msg.push(`${pg.items.length} genuine numbers${pg.vin?' for VIN '+pg.vin:''}`);continue;}const fy=pg.items.filter(i=>i.fits==='yes').length,fn=pg.items.filter(i=>i.fits==='no').length;msg.push(pg.vehicle?`${pg.vehicle}: ${fy} fit${fn?`, ${fn} don’t fit`:''}${pg.items.length-fy-fn?`, ${pg.items.length-fy-fn} unconfirmed`:''}`:`${pg.items.length} products (no vehicle selected, so no fitment)`);}catch(err){msg.push(`${f.name}: couldn’t read it`);}}
    saveRepco(pgs);st.pcache={};renderRepcoPanel();renderDiagrams();toast('Imported '+msg.join(' · '));setTimeout(()=>toast(''),5000);};
  const c=$('#repcoClear');if(c)c.onclick=()=>{saveRepco([]);st.pcache={};renderRepcoPanel();};}
function alertBox(t){toast(t);setTimeout(()=>toast(''),4000);}
/* ---------- Diagrams: exact ones from imported genuine pages and team photos ---------- */
function shrinkImg(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const sc=Math.min(1,1100/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',.74));};img.onerror=rej;img.src=r.result;};r.onerror=rej;r.readAsDataURL(file);});}
function pageMatchesVehicle(pg){const v=st.vehicle;if(!v||v.manual)return false;if(v.vinStr&&pg.vin&&v.vinStr===pg.vin)return true;if(pg.diagramOnly)return pg.vehicle===v.vehicle;
  const mk=(v.make||'').toLowerCase(),md=(v.model||'').toLowerCase().split(/\s+/)[0]||'';const lab=`${pg.vehicle} ${pg.source}`.toLowerCase();return!!(mk&&md&&lab.includes(mk)&&lab.includes(md));}
function diagramsForVehicle(){const out=[];loadRepco().forEach((pg,pi)=>{if(!(pg.diagrams||[]).length||!(pg.genuine||pg.diagramOnly)||!pageMatchesVehicle(pg))return;pg.diagrams.forEach((d,di)=>out.push({...d,kind:pg.genuine?'Genuine catalogue':'Team photo',from:pg.genuine?pg.source:'',date:pg.date,pi,di}));});return out;}
const DG_CATS=[['all','All'],['belt','Belts & pulleys',/belt|pulley|fan|tensioner|idler|alternator|serpentine/i],['fuse','Fuse & relay',/fuse|relay/i],['engine','Engine',/engine|cylinder|head|cover|gasket|timing|oil|manifold/i],['cool','Cooling',/radiator|cool|water pump|thermostat/i],['brake','Brakes & suspension',/brake|caliper|suspension|axle|hub/i],['elec','Electrical',/wiring|electrical|sensor|lamp|light/i]];
let dgCat='all';
function smcSlug(x){return String(x||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function smcLinks(v){let mk=String(v.make||''),md=String(v.model||'').trim();
  if(/great wall|gwm/i.test(mk)&&/^haval\s+/i.test(md)){mk='Haval';md=md.replace(/^haval\s+/i,'');}if(/^(haval|tank|ora|cannon)\b/i.test(md)&&/great wall|gwm/i.test(mk)){const w=md.split(/\s+/);mk=w.shift();md=w.join(' ');}
  const TRIM=/\b(ultra|lux|premium|sport|sr5|sr|gx|gxl|vx|sahara|st|ti|ti-l|maxx|touring|akera|gt|xls|xlt|wildtrak|limited|base|plus|elite|active|highlander|titanium|trend|ambiente|lt|ltz|ls)\b.*$/i;
  md=md.replace(TRIM,'').trim();const multi=/\s/.test(md);mk=smcSlug(mk);md=smcSlug(md);
  const base=mk&&md&&!multi?`https://www.startmycar.com/au/${mk}/${md}`:null;const g=t=>`https://www.google.com/search?q=${encodeURIComponent(`${vshort()} ${t} site:startmycar.com`)}`;
  const L=[['Fuse box diagram','/info/fusebox','fuse box'],['Owner’s manuals','/info/manuals','owners manual'],['Service & repair manuals (with diagrams)','/info/manuals/service-repair','service repair manual'],['How-to guides','/guides','guide']];
  return `<div class="smc"><div class="small muted">Manuals and fuse box diagrams on StartMyCar (a community site, so check fuse layouts against the diagram on the fuse box lid):</div><div class="plinks" style="margin-top:4px">${L.map(([t,p,q])=>lnk(base?base+p:g(q),t+' ↗')).join('')}</div></div>`;}
function renderDiagrams(){const box=$('#dgList');if(!box)return;const all=diagramsForVehicle();const v=st.vehicle||{};const vs=vshort();
  $('#dgChips').innerHTML=DG_CATS.map(c=>{const n=c[0]==='all'?all.length:all.filter(d=>c[2].test(d.title)).length;return `<button class="chip ${dgCat===c[0]?'on':''}" data-dg="${c[0]}" type="button">${c[1]} (${n})</button>`;}).join('');
  $$('#dgChips .chip').forEach(b=>b.onclick=()=>{dgCat=b.dataset.dg;renderDiagrams();});
  const cat=DG_CATS.find(c=>c[0]===dgCat);const list=dgCat==='all'?all:all.filter(d=>cat[2].test(d.title));
  box.innerHTML=list.length?list.map(d=>`<figure class="dg"><a href="${esc(d.src)}" target="_blank" rel="noopener"><img src="${esc(d.src)}" alt="${esc(d.title)} for ${esc(v.vehicle||'')}" loading="lazy" onerror="this.closest('figure').classList.add('broken')"></a><figcaption><b>${esc(cap(d.title))}</b><span class="vb ${d.kind==='Genuine catalogue'?'ok':'repco'}">✓ ${esc(d.kind)}</span><span class="small muted">${esc(d.date)}${d.from?' · '+lnk(d.from,'source page'):''}</span><button class="linkbtn" data-dgdel="${d.pi}:${d.di}" type="button">remove</button></figcaption></figure>`).join('')
    :`<p class="muted">No ${dgCat==='all'?'':esc(cat[1].toLowerCase())+' '}diagrams saved for ${esc(vs)} yet.</p>`;
  const vin=v.vinStr;const q=s=>encodeURIComponent(s);
  $('#dgFind').innerHTML=`<div class="dgadd"><label class="btn sm primary" for="dgFile">📷 Add a diagram photo</label><input id="dgFile" type="file" accept="image/*" multiple hidden><span class="small muted">e.g. the belt routing sticker under the bonnet, the fuse box lid, or a workshop manual page. Saved for ${esc(vs)} in this browser.</span></div>
${smcLinks(v)}<div class="small muted" style="margin-top:10px">Find the exact diagram (one tap, then save the page or a screenshot and add it here):</div>
<div class="plinks" style="margin-top:4px">${lnk(vin?`https://partsouq.com/en/search/all?q=${vin}`:'https://partsouq.com/',vin?'Genuine diagrams for your VIN (Partsouq) ↗':'Genuine diagrams (Partsouq, enter VIN) ↗')}${lnk(`https://www.google.com/search?q=${q(vs+' drive belt site:gates.com.au OR site:gatesaustralia.com.au OR site:dayco.com.au')}`,'Gates / Dayco belt routing ↗')}${lnk(`https://www.google.com/search?tbm=isch&q=${q(vs+' '+(st.engine?.code||'')+' serpentine belt routing diagram')}`,'Belt routing images ↗')}${lnk(`https://www.google.com/search?tbm=isch&q=${q(vs+' fuse box diagram')}`,'Fuse box diagrams ↗')}</div>`;
  $('#dgFile').onchange=async e=>{const pgs=loadRepco();let n=0;for(const f of e.target.files){try{const img=await shrinkImg(f);pgs.push({diagramOnly:true,vehicle:v.vehicle,vin:v.vinStr||'',source:f.name,date:new Date().toISOString().slice(0,10),items:[],diagrams:[{src:img,title:f.name.replace(/\.[a-z]+$/i,'').replace(/[_-]+/g,' ')}]});n++;}catch(err){}}
    saveRepco(pgs);toast(n?`Added ${n} diagram${n>1?'s':''} for ${vs}`:'Couldn’t read that image');setTimeout(()=>toast(''),3000);renderDiagrams();};
  $$('[data-dgdel]').forEach(b=>b.onclick=()=>{const[pi,di]=b.dataset.dgdel.split(':').map(Number);const pgs=loadRepco();const pg=pgs[pi];if(!pg)return;pg.diagrams.splice(di,1);if(pg.diagramOnly&&!pg.diagrams.length)pgs.splice(pi,1);saveRepco(pgs);renderDiagrams();});}
/* ---------- Resources: where the info lives (real links only) ---------- */
const RES_NEEDS=[['parts','Parts & numbers','parts'],['oem','Genuine OEM','parts catalogue'],['diagrams','Diagrams & manuals','workshop manual diagram'],['belt','Belt routing','drive belt routing diagram'],['fuse','Fuse box','fuse box diagram'],['specs','Specs & torque','specifications torque'],['fluids','Fluids & capacities','oil capacity coolant type'],['forums','Forums & fixes','forum problem fix']];
const RES={
 oem:[['Partsouq','partsouq.com','Genuine catalogue by VIN, exploded diagrams',v=>v.vinStr?`https://partsouq.com/en/search/all?q=${v.vinStr}`:null],['Amayama','amayama.com','Genuine Japanese and Korean catalogues'],['Megazip','megazip.net','Genuine Japanese catalogues with diagrams'],['7zap','7zap.com','Genuine EPC diagrams, many makes'],['Catcar','catcar.info','Genuine EPC catalogues'],['RealOEM','realoem.com','Genuine BMW and MINI diagrams']],
 stores:[['Repco','repco.com.au','Catalogue and stock',(v,t)=>`https://www.repco.com.au/search?text=${encodeURIComponent(t)}`],['Supercheap Auto','supercheapauto.com.au','Catalogue and stock'],['Autobarn','autobarn.com.au','Catalogue and stock'],['Burson','burson.com.au','Trade parts'],['Sparesbox','sparesbox.com.au','Online parts'],['Autopro','autopro.com.au','Parts stores'],['Auto One','autoone.com.au','Parts stores'],['eBay Australia','ebay.com.au','New and used',(v,t)=>`https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent(t)}`]],
 brands:[['Ryco','ryco.com.au','Filter finder'],['Wesfil','wesfil.com.au','Filter finder'],['Narva','narva.com.au','Globes and electrical'],['NGK','ngk.com.au','Plugs, glow plugs, sensors'],['Bendix','bendix.com.au','Brake pads'],['DBA','dba.com.au','Rotors and calipers'],['Gates','gatesaustralia.com.au','Belts, hoses, routing'],['Dayco','dayco.com.au','Belts, tensioners, routing'],['Century','centurybatteries.com.au','Battery finder'],['Bosch','bosch.com.au','Wipers, filters, parts'],['KYB','kyb.com.au','Shocks and struts'],['Pedders','pedders.com.au','Suspension']],
 manuals:[['StartMyCar','startmycar.com','Fuse boxes, manuals, guides'],['ManualsLib','manualslib.com','Owner’s and service manuals'],['Haynes','haynes.com','Workshop manuals'],['fuse-box.info','fuse-box.info','Fuse box diagrams by model'],['YouTube','youtube.com','Watch the job done',(v,t)=>`https://www.youtube.com/results?search_query=${encodeURIComponent(t)}`]],
 specs:[['RedBook','redbook.com.au','Australian model specs'],['Drive','drive.com.au','AU specs and reviews'],['CarsGuide','carsguide.com.au','AU specs and common problems'],['auto-data.net','auto-data.net','Engine and model specs'],['Ultimate Specs','ultimatespecs.com','Detailed specs']],
 forums:[['Whirlpool','whirlpool.net.au','Australian forums'],['Reddit','reddit.com','r/MechanicAdvice and model subs'],['Model forums','','Owners’ clubs and forums',(v,t)=>`https://www.google.com/search?q=${encodeURIComponent(t+' forum')}`]]};
const RES_GROUPS={parts:['stores','brands','oem'],oem:['oem','stores'],diagrams:['manuals','oem'],belt:['brands','manuals','forums'],fuse:['manuals','brands','forums'],specs:['specs','manuals','forums'],fluids:['specs','manuals'],forums:['forums','manuals']};
const RES_TITLES={oem:'Genuine catalogues',stores:'Australian parts stores',brands:'Brand catalogues',manuals:'Diagrams and manuals',specs:'Specs',forums:'Forums and owners'};
let resNeed='parts';
function renderResources(){const box=$('#resList');if(!box||!st.vehicle||st.vehicle.manual)return;const v=st.vehicle;const vs=vshort()+(st.engine?.code?' '+st.engine.code:'');
  const term=RES_NEEDS.find(n=>n[0]===resNeed)[2];const t=`${vs} ${term}`.trim();
  $('#resChips').innerHTML=RES_NEEDS.map(n=>`<button class="chip ${resNeed===n[0]?'on':''}" data-res="${n[0]}" type="button">${n[1]}</button>`).join('');
  $$('#resChips .chip').forEach(b=>b.onclick=()=>{resNeed=b.dataset.res;renderResources();$('#resWeb').innerHTML='';});
  const gs=(d,q)=>`https://www.google.com/search?q=${encodeURIComponent(q+' site:'+d)}`;
  const BRAND_FOR={belt:['Gates','Dayco'],fuse:['Narva'],parts:null};const pick=g=>g==='brands'&&BRAND_FOR[resNeed]!==undefined&&BRAND_FOR[resNeed]?RES.brands.filter(b=>BRAND_FOR[resNeed].includes(b[0])):RES[g];
  box.innerHTML=RES_GROUPS[resNeed].map(g=>`<div class="resgrp"><div class="nlab">${RES_TITLES[g]}</div><div class="links">${pick(g).map(([n,d,desc,fn])=>{const u=(fn&&fn(v,t))||(d?gs(d,t):null);return u?`<a class="lk" href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(n)} ↗</b><span>${esc(desc)}</span></a>`:'';}).join('')}</div></div>`).join('');
  $('#resQuery').textContent=t;}
async function findWebPages(){const out=$('#resWeb');const vs=vshort()+(st.engine?.code?' '+st.engine.code:'');const need=RES_NEEDS.find(n=>n[0]===resNeed);
  if(!canVerify()){out.innerHTML=errBox({code:'nokey'});return;}
  out.innerHTML=skel(`Searching the web for ${need[1].toLowerCase()} for ${vs}…`);const meta={};
  try{const r=await ask(`Use Google search to find the most useful web pages for this need. ${ctxLine()} Need: ${need[1]} (${need[2]}). Prefer official, genuine catalogue, manual and well-known Australian sources, then forums. Search several times with different wording. Return ONLY JSON {"pages":[{"title":"","url":"","why":"one short line"}]} listing up to 12 pages you actually found.`,{json:true,web:true,meta,tier:'default',maxTokens:4000});
    const real=(meta.sources||[]).filter(x=>x.uri);const listed=(r.pages||[]).filter(x=>x&&/^https?:/.test(x.url||''));const host=u=>String(u).replace(/^https?:\/\/(www\.)?/,'').split('/')[0];
    const seen=new Set();const rows=[];
    real.forEach(x=>{const k=x.uri;if(seen.has(k))return;seen.add(k);const isRedirect=/vertexaisearch|grounding-api-redirect/.test(x.uri);const m=listed.find(l=>(x.title||'').toLowerCase().includes(host(l.url))||l.url===x.uri);rows.push({title:m?.title||x.title,url:x.uri,why:m?.why||'',domain:isRedirect?(x.title||''):host(x.uri)});});
    out.innerHTML=rows.length?`<div class="small muted" style="margin:8px 0 6px">Pages the search actually found:</div><div class="links">${rows.slice(0,15).map(x=>`<a class="lk" href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.title||x.domain)} ↗</b><span>${esc(x.domain||'')}${x.why?' · '+esc(x.why):''}</span></a>`).join('')}</div>`:'<p class="muted small">The search didn’t return any pages this time. Try another need or tap again.</p>';}
  catch(e){out.innerHTML=errBox(e);}}
/* ---------- engine detail panel (called by diagram.js) ---------- */
function renderDetail(){const el=$('#detail'),c=st.sel;if(!c){el.innerHTML='<p class="muted" style="margin:0">Tap any part of the engine, or a chip above, to see what it does on this engine.</p>';return;}
  const note=st.spec?.components?.[c],gen=GEN[c]||'',manual=st.vehicle?.manual;
  el.innerHTML=`<div class="dhead"><h4>${esc(COMPS[c]||c)}</h4><button class="x" id="dclose" aria-label="Clear selection" type="button">×</button></div>
<p>${esc(note||gen)}</p>${note&&gen?`<p class="muted small">${esc(gen)}</p>`:''}
${manual?'':`<button class="btn sm" id="dparts" type="button">Find these parts</button><button class="btn sm ghost" id="dexp" type="button">Explain in depth</button><div id="dexpout" class="answer"></div>`}`;
  $('#dclose').onclick=()=>select(null);
  const dp=$('#dparts');if(dp)dp.onclick=()=>{$('#psq').value=COMPS[c];partSearch(COMPS[c]+' (engine parts)');$('#sec-parts').scrollIntoView({behavior:'smooth'});};
  const dx=$('#dexp');if(dx)dx.onclick=()=>{dx.disabled=true;answer(`${ctx()}\n\nExplain the ${COMPS[c]} on this specific engine, in depth, for a capable home mechanic: design on this engine (materials, specifics), how it works, common failure modes and symptoms, how to inspect or test it, and replacement tips with specs (torques, clearances) only where you're confident. Short paragraphs and bullets, metric, under 350 words. Say plainly if unsure.`,$('#dexpout')).finally(()=>dx.disabled=false);};}
function md(t){const inl=s=>s.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>');const lines=esc(t).split('\n');let h='',list=false;
  for(const ln of lines){const m=ln.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);if(m){if(!list){h+='<ul>';list=true;}h+='<li>'+inl(m[1])+'</li>';continue;}if(list){h+='</ul>';list=false;}
    const hd=ln.match(/^#{1,4}\s+(.*)/);if(hd){h+='<h4>'+inl(hd[1])+'</h4>';continue;}if(ln.trim())h+='<p>'+inl(ln)+'</p>';}
  if(list)h+='</ul>';return h;}
async function answer(prompt,el){el.innerHTML='<span class="muted">Thinking…</span>';try{el.innerHTML=md(await ask(prompt,{cache:false,web:liveOn()}));}catch(e){el.innerHTML=errBox(e);}}

/* ---------- specs, service, issues, catalogues ---------- */
const withUnit=(v,u)=>v==null||v===''?null:(typeof v==='number'||/^\d+(\.\d+)?$/.test(String(v)))?`${v} ${u}`:String(v);
const SPEC_KEYS=[['code','Engine code'],['manufacturer','Maker'],['family','Family'],['displacement_cc','Displacement',v=>withUnit(v,'cc')],['layout','Layout',(v,e)=>`${e.layout||''}${e.cylinders?' '+e.cylinders+'-cyl':''}${e.vAngle?' ('+e.vAngle+'°)':''}`],['bore_mm','Bore',v=>withUnit(v,'mm')],['stroke_mm','Stroke',v=>withUnit(v,'mm')],['compression','Compression'],['valvetrain','Valvetrain',(v,e)=>v+(e.valvesPerCyl?`, ${e.valvesPerCyl} valves/cyl`:'')],['variableValveTiming','Variable valve timing'],['aspiration','Induction'],['fuel','Fuel'],['injection','Injection'],['timingDrive','Timing drive'],['interference','Interference engine'],['firingOrder','Firing order'],['power','Power'],['torque','Torque'],['redline_rpm','Redline',v=>withUnit(v,'rpm')],['blockMaterial','Block'],['headMaterial','Head'],['ignition','Ignition'],['emissions','Emissions'],['weight_kg','Weight',v=>withUnit(v,'kg')]];
function table(rows,cols){if(!rows||!rows.length)return'<p class="muted small">Nothing listed.</p>';return `<table><thead><tr>${cols.map(c=>`<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c[0]]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function renderSpec(){const r=st.spec||{},e=r.engine||{};$('#rOverview').textContent=r.overview||'';
  const cells=SPEC_KEYS.map(([k,l,fn])=>{const v=e[k];if(v==null||v===''||v==='null')return'';const out=fn?fn(v,e):v;return out?`<div class="spec"><small>${l}</small><b>${esc(out)}</b></div>`:'';}).join('');
  $('#specs').innerHTML=`<div class="specgrid">${cells||'<p class="muted">No specs returned.</p>'}</div>`;
  const u=(r.uncertain||[]).filter(Boolean);$('#uncertain').innerHTML=u.length?`<b>Less certain:</b> ${esc(u.join('; '))}`:'';
  $('#fluids').innerHTML=table(r.fluids,[['item','Item'],['spec','Spec'],['capacity','Capacity']]);
  $('#service').innerHTML=table(r.service,[['item','Item'],['interval','Interval'],['notes','Notes']]);
  $('#torque').innerHTML=table(r.torque,[['item','Fastener'],['value','Torque'],['notes','Notes']]);
  const iss=r.knownIssues||[];$('#issues').innerHTML=iss.length?iss.map(i=>`<div class="issue ${esc(i.severity||'low')}"><b>${esc(i.title)}</b><p>${esc(i.detail)}</p></div>`).join(''):'<p class="muted">No common issues listed.</p>';}
function renderLinks(){const v=st.vehicle,code=st.spec?.engine?.code||st.engine?.code||'',name=v.vehicle,vin=v.vinStr;const slug=x=>String(x||'').toLowerCase().trim().replace(/\s+/g,'+');
  const ra=v.make&&v.model&&/^\d{4}$/.test(String(v.year))?`https://www.rockauto.com/en/catalog/${slug(v.make)},${v.year},${slug(v.model)}`:'https://www.rockauto.com/';
  const L=[['Partsouq OEM catalogue',vin?`https://partsouq.com/en/search/all?q=${vin}`:'https://partsouq.com/',vin?'Opens your VIN: genuine exploded diagrams and part numbers':'Enter your VIN for genuine exploded diagrams and part numbers'],
    ['7zap OEM diagrams','https://7zap.com/en/','Factory parts diagrams for many makes'],['Amayama genuine parts','https://www.amayama.com/en','Japanese and Korean OEM catalogues'],
    ['Engine diagrams (images)',`https://www.google.com/search?tbm=isch&q=${qv((code||name)+' engine diagram')}`,'Cutaways, layout and vacuum diagrams'],
    ['Fuse box diagram',`https://www.google.com/search?tbm=isch&q=${qv(name+' fuse box diagram')}`,'Fuse and relay layouts'],
    ['Narva globe & wiper finder','https://www.narva.com.au/','Narva’s vehicle application lookup'],
    ['RockAuto',ra,'Mainly US-market models, handy for cross-referencing numbers'],
    ['Teardown & repair videos',`https://www.youtube.com/results?search_query=${qv((code?code+' ':'')+name+' repair')}`,'See the job done'],
    ['eBay Australia',ebay(name+' parts'),'New and used parts']];
  $('#links').innerHTML=L.map(([t,u,d])=>`<a class="lk" href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(t)} ↗</b><span>${esc(d)}</span></a>`).join('');}
$('#askf').addEventListener('submit',ev=>{ev.preventDefault();const q=$('#askq').value.trim();if(!q||!st.engine)return;answer(`${ctx()}\n\nQuestion from the owner (in Australia): ${q}\n\nAnswer directly and practically for this exact vehicle. Metric units. Flag anything you're unsure of. Under 300 words.`,$('#ans'));});
$$('#secnav button').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.go)?.scrollIntoView({behavior:'smooth',block:'start'}));

$('#resFind').onclick=findWebPages;
/* ---------- settings panel ---------- */
function openSettings(){$('#sRules').value=cfg.rules??DEFAULT_RULES;$('#sGroq').value=cfg.groqKey||'';$('#sStore').value=cfg.store||'Repco';$('#sBrands').value=cfg.brands||DEFAULT_BRANDS;$('#sGem').value=cfg.geminiKey||'';$('#sSpeed').value=cfg.speed||'fast';const pv=cfg.provider||'gemini';$$('input[name=prov]').forEach(r=>r.checked=r.value===pv);provUI();$('#sKey').value=cfg.apiKey||'';$('#sModel').value=cfg.model||'claude-sonnet-5-5';$('#sLive').checked=!!cfg.live;$('#sReg').value=cfg.regcheck||'';$('#sClaude').hidden=!sample;$('#settings').hidden=false;}
$('#setBtn').onclick=openSettings;$('#aiBadge').onclick=openSettings;
$('#sClose').onclick=()=>$('#settings').hidden=true;
$('#settings').addEventListener('click',e=>{if(e.target.id==='settings')$('#settings').hidden=true;});
function provUI(){const pv=($$('input[name=prov]').find(r=>r.checked)||{}).value||'gemini';$('#pGem').hidden=pv==='anthropic';$('#pAnt').hidden=pv!=='anthropic';}
$$('input[name=prov]').forEach(r=>r.onchange=provUI);
$('#sTest').onclick=geminiDiag;
$('#sSave').onclick=()=>{cfg.provider=($$('input[name=prov]').find(r=>r.checked)||{}).value||'gemini';cfg.geminiKey=$('#sGem').value.trim();cfg.groqKey=$('#sGroq').value.trim();cfg.rules=$('#sRules').value;cfg.store=$('#sStore').value.trim()||'Repco';cfg.brands=$('#sBrands').value.trim()||DEFAULT_BRANDS;st.pcache={};cfg.speed=$('#sSpeed').value;gList=null;cfg.apiKey=$('#sKey').value.trim();cfg.model=$('#sModel').value;cfg.live=$('#sLive').checked;cfg.regcheck=$('#sReg').value.trim();saveCfg();$('#settings').hidden=true;};
$('#sClear').onclick=()=>{cfg={};saveCfg();openSettings();};

/* ---------- manual sketch + recent ---------- */
$('#manualBtn').onclick=()=>{$('#manual').hidden=!$('#manual').hidden;};
$('#mdraw').onclick=()=>{const e={layout:$('#mLayout').value,cylinders:+$('#mCyl').value,valvetrain:$('#mVt').value,aspiration:$('#mAsp').value,fuel:$('#mFuel').value,injection:$('#mInj').value,timingDrive:$('#mTd').value};
  if(e.layout==='rotary')e.cylinders=2;if(e.layout==='electric'){e.cylinders=0;e.fuel='electric';}
  st.ver++;st.vehicle={vehicle:'Engine sketch',manual:true,engines:[]};st.spec=null;st.sel=null;st.s=normSpec(e);
  const lbl=e.layout==='electric'?'Electric drive unit':e.layout==='rotary'?'Twin-rotor rotary':`${e.layout==='V'?'V':e.layout==='flat'?'Flat-':'Inline-'}${e.cylinders} ${e.valvetrain} ${e.aspiration==='NA'?'':e.aspiration+' '}${e.fuel}, ${e.timingDrive} timing`;
  st.engine={label:lbl};status('');$('#choose').hidden=true;const res=$('#result');res.hidden=false;res.classList.add('manual');
  $('#rTitle').textContent='Engine sketch';$('#rMarket').textContent=lbl;$('#rIds').innerHTML='';$('#rOverview').textContent='A generic diagram drawn from the layout you picked. Search a real vehicle to get its parts, specs and known issues.';
  renderDiagram();renderDetail();$('#sec-diagram').scrollIntoView({behavior:'smooth'});};
function loadRecent(){try{return JSON.parse(localStorage.getItem('ps-recent')||'[]')}catch(e){return[]}}
function saveRecent(q,h){try{let r=loadRecent().filter(x=>x.q.toLowerCase()!==q.toLowerCase());r.unshift({q,h});localStorage.setItem('ps-recent',JSON.stringify(r.slice(0,6)));}catch(e){}renderRecent();}
function renderRecent(){const r=loadRecent();const ex=[{q:'2022 Haval H6 Ultra'},{q:'2016 Toyota Hilux SR5 2.8 diesel'},{q:'2014 Holden Commodore VF SS'},{q:'2019 Mazda CX-5 Maxx'},{q:'2015 Subaru WRX'},{q:'2023 Tesla Model 3'}];const list=r.length?r:ex;
  $('#recent').innerHTML=`<span class="chiplab">${r.length?'Recent':'Try'}</span>`+list.map((x,i)=>`<button class="chip" data-i="${i}" type="button">${esc(x.q)}</button>`).join('');
  $$('#recent .chip').forEach(b=>b.onclick=()=>{const x=list[+b.dataset.i];$('#q').value=x.q;$('#hint').value=x.h||'';$$('#findTabs button')[0].click();runSearch(x.q,x.h||'');});}
st.pcache={};renderRecent();updateAiBadge();
