/* PartsFinder: app layer (lookups, parts, cross-references). Diagram engine lives in diagram.js. */

/* ---------- settings ---------- */
const CFG_KEY='ps-settings';
let cfg=(()=>{try{return JSON.parse(localStorage.getItem(CFG_KEY)||'{}')}catch(e){return{}}})();
function saveCfg(){try{localStorage.setItem(CFG_KEY,JSON.stringify(cfg))}catch(e){}updateAiBadge();}

/* ---------- AI layer: Claude inside claude.ai, or the user's own Anthropic API key anywhere else ---------- */
let sample=null;
const samplePromise=(async()=>{try{if(window.claude&&typeof window.claude.use==='function')sample=await window.claude.use('sample');}catch(e){sample=null}updateAiBadge();return sample;})();
function aiMode(){const prov=cfg.provider||'gemini';if(prov==='gemini'&&cfg.geminiKey)return'gemini';if(prov==='anthropic'&&cfg.apiKey)return'api';if(cfg.geminiKey)return'gemini';if(cfg.apiKey)return'api';if(sample)return'claude';return'none';}
const liveOn=()=>(aiMode()==='api'||aiMode()==='gemini')&&!!cfg.live;
function updateAiBadge(){const m=aiMode(),b=$('#aiBadge');if(!b)return;
  b.textContent=(m==='gemini'?'Gemini':m==='api'?'Claude API':m==='claude'?'Claude':'Set up lookups')+((m==='gemini'||m==='api')&&cfg.live?' · live':'');b.className='badge '+(m==='none'?'bad':'ok');
  const n=$('#aiNote');if(n){n.hidden=m!=='none';n.innerHTML='Lookups need an AI key. Open <b>Settings</b> and paste a free Google Gemini key (takes a minute to get). Engine sketches work without one.';}}
function parseLoose(t){if(t==null)throw new Error('Empty answer');if(typeof t==='object')return t;t=String(t);
  const fence=t.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fence&&fence[1].includes('{'))t=fence[1];
  const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<0)throw new Error('The answer had no data in it');return JSON.parse(t.slice(a,b+1));}
async function apiCall(prompt,{web=false,maxTokens=12000}={}){
  const body={model:cfg.model||'claude-sonnet-5-5',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]};
  if(web)body.tools=[{type:'web_search_20250305',name:'web_search',max_uses:6}];
  let r;try{r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':cfg.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify(body)});}
  catch(e){const x=new Error('Couldn’t reach the Anthropic API from this page.');x.code='network';throw x;}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const x=new Error(j?.error?.message||('HTTP '+r.status));x.code=r.status===429||r.status===529?'rate_limited':r.status===401||r.status===403?'bad_key':'api';throw x;}
  return(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');}
const GEM_MODELS=['gemini-flash-latest','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3-flash-preview','gemini-2.5-flash'];
async function geminiCall(prompt,{web=false,maxTokens=24000}={}){const list=[...new Set([cfg.gModel,...GEM_MODELS].filter(Boolean))];let last;
  for(const m of list){const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens}};if(web)body.tools=[{google_search:{}}];
    let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':cfg.geminiKey},body:JSON.stringify(body)});}
    catch(e){const x=new Error('Couldn’t reach the Gemini API from this page.');x.code='network';throw x;}
    const j=await r.json().catch(()=>({}));
    if(r.ok){if(cfg.gModel!==m){cfg.gModel=m;saveCfg();}const c=j.candidates?.[0];const t=(c?.content?.parts||[]).filter(p=>p.text&&!p.thought).map(p=>p.text).join('');
      if(!t)throw new Error(c?.finishReason?`No answer (${c.finishReason}). Try again or reword the search.`:'Empty answer');return t;}
    const msg=j?.error?.message||('HTTP '+r.status);last=new Error(msg);
    last.code=(r.status===401||r.status===403||(r.status===400&&/api key/i.test(msg)))?'bad_key':r.status===429?'rate_limited':'api';
    if(r.status===404||(r.status===429&&/limit: ?0|free.?tier/i.test(msg))){if(cfg.gModel===m){cfg.gModel='';}continue;}
    throw last;}
  throw last;}
async function ask(prompt,o={}){await samplePromise;const m=aiMode();if(m==='none')throw{code:'nokey'};let text;
  if(m==='gemini'){try{text=await geminiCall(prompt,o);}catch(e){if(o.web&&e.code==='api'){text=await geminiCall(prompt,{...o,web:false});}else throw e;}}
  else if(m==='api'){try{text=await apiCall(prompt,o);}catch(e){if(o.web&&e.code==='api'){text=await apiCall(prompt,{...o,web:false});}else throw e;}}
  else{if(o.json&&typeof sample.json==='function'){try{return parseLoose(await sample.json(prompt,{modelTier:o.tier||'default'}));}catch(e){if(e&&e.code)throw e;}}
    const r=await sample(prompt,{modelTier:o.tier||'default',cache:o.cache});text=r.text;}
  return o.json?parseLoose(text):text;}
function errMsg(e){if(!e)return'Something went wrong.';
  if(e.code==='nokey')return'No AI key set up yet. Open Settings and paste your free Gemini key.';
  if(e.code==='bad_key')return'The API key was rejected. Check it in Settings.';
  if(e.code==='not_granted')return'Claude access wasn’t allowed for this page. Allow it, or add an API key in Settings.';
  if(e.code==='rate_limited')return'Hit the speed limit for your key. Wait a minute and try again.';
  return'Lookup failed: '+(e.message||String(e));}
const errBox=e=>`<div class="errbox">${esc(errMsg(e))}${e&&(e.code==='nokey'||e.code==='bad_key')?' <button class="linkbtn" data-open-settings type="button">Open settings</button>':''}</div>`;
const skel=t=>`<div class="skel"><span class="spin"></span>${esc(t)}</div>`;
function status(html,loading,err){const el=$('#status');if(!html){el.innerHTML='';return;}el.innerHTML=`<div class="card st ${err?'err':''}">${loading?'<span class="spin"></span>':''}<span>${html}</span></div>`;}
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
function storeLinks(q,few){const s=few?STORES.slice(0,3):STORES;return s.map(([n,d])=>lnk(gsite(q,d),n)).join('')+lnk(ebay(q),'eBay');}
const vshort=()=>{const v=st.vehicle||{};return[v.year,v.make,v.model].filter(Boolean).join(' ')||v.vehicle||'';};

/* ---------- prompts ---------- */
function ctxLine(){const v=st.vehicle,e=st.engine;return `Vehicle: ${v.vehicle}${v.market?` (${v.market} market)`:''}${v.vinStr?`. VIN: ${v.vinStr}`:''}${v.rego?`. Rego: ${v.rego}`:''}. Engine: ${e?.label||'unknown'}${e?.code?` [${e.code}]`:''}.`;}
function ctx(){return ctxLine()+` Known engine data: ${JSON.stringify(st.spec?.engine||{})}`;}
function idPrompt(q,hint){return `You are an automotive data expert at an Australian parts counter. Identify the vehicle described below and list its factory engine options.
Input: "${q}"${hint?`\nEngine hint from the user: "${hint}"`:''}
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
function partsPrompt(query,cat){return `You are an experienced parts interpreter at an Australian parts store (think Repco, Burson, Supercheap trade counter).
${ctxLine()}
${cat?`Category requested: ${cat}`:`Customer's search: "${query}"`}
Read abbreviations and trade slang the way a parts interpreter would (e.g. LCA = lower control arm, W/B = wiper blade, H7 = headlight globe type, "15A" = fuse rating). This covers the WHOLE vehicle, not just the engine.
List every matching part fitted to this vehicle (up to 30). List positions separately (front/rear, LH/RH; in Australia RH is the driver side) when part numbers or sizes differ.
For every part give:
- "oem": genuine part number(s) as an array. Include a number ONLY if you are confident it is right for this vehicle; otherwise an empty array.
- "specs": the details a counter person checks, as key-value pairs. E.g. thread size and pitch, length, diameter, hole size, globe type/base/wattage/voltage, fuse rating/type/position, wiper length in mm and inches plus connector, capacity, CCA, viscosity, dimensions.
- "crossRefs": aftermarket equivalents commonly stocked in Australia (brands such as Narva, OEX, Projecta, Philips, Osram, Hella, Ryco, Wesfil, Sakura, NGK, Denso, Bosch, Bendix, DBA, RDA, Protex, Gates, Dayco, Mackay, KYB, Monroe, Pedders, Tridon, Bosal, Valeo, Trico, Exedy, Repco own brand), as {"brand","number","store":"where it is usually sold, e.g. Repco / Burson / Supercheap","notes"}. Only numbers you are confident of. Leave numbers out rather than inventing them.
Return ONLY JSON:
{"interpreted":"one line on how you read the request","items":[{"name":"","position":"","oem":[],"specs":{},"qty":"","crossRefs":[],"notes":"","confidence":"high|medium|low"}],"tips":"optional short note, e.g. check build date or VIN for a split"}`;}
function xrefPrompt(num,veh){return `You are an expert parts interpreter in Australia. Cross-reference this part number.
Part number: "${num}"${veh?`\nVehicle context: ${veh}`:''}
Work out what the part is and which brand the number belongs to (a car maker's genuine number, or an aftermarket brand such as Ryco, Wesfil, Narva, OEX, NGK, Bendix). Then give cross-references:
- Other genuine numbers (supersessions or the same part from sister brands).
- Aftermarket equivalents stocked in Australia, e.g. OEM > Ryco/Wesfil/Sakura for filters, OEM > Narva/Philips/OEX for globes and electrical, OEM > Bendix/DBA/RDA for brakes, OEM > NGK/Denso/Bosch for plugs.
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
  out.innerHTML=`${why?`<div class="errbox">${esc(why)}</div>`:''}<p class="small">${cfg.regcheck?'':'Turning a plate into a VIN automatically needs a paid vehicle-data service; add a RegCheck username in Settings to switch it on. '}You can also open the free ${state} check, then paste the VIN here. The VIN is also on your rego papers, at the base of the windscreen and on the driver-side door pillar.</p>
<div class="row"><a class="btn sm" href="${REGO[state]}" target="_blank" rel="noopener">Open ${state} rego check ↗</a></div>
<div class="row" style="margin-top:8px"><input id="regoVin" type="text" placeholder="Paste VIN"><button class="btn" id="regoVinGo" type="button">Use VIN</button></div>`;
  $('#regoVinGo').onclick=()=>{const v=$('#regoVin').value.replace(/\s/g,'').toUpperCase();if(isVin(v))runSearch(v,'',{rego:`${plate} ${state}`});else $('#regoVin').focus();};}
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
  catch(e){regoManual(state,plate,`Automatic lookup didn’t work (${e.message==='Failed to fetch'?'the service blocked a browser request':e.message}).`);}});

/* ---------- part-number cross reference ---------- */
$('#fPn').addEventListener('submit',ev=>{ev.preventDefault();const n=$('#pn').value.trim();if(n)xref(n,$('#pnVeh').value.trim(),$('#pnOut'));});
async function xref(num,veh,el){el.innerHTML=skel(`Cross-referencing ${num}…${liveOn()?' (checking the web)':''}`);
  try{const r=await ask(xrefPrompt(num,veh),{json:true,web:liveOn()});el.innerHTML=xrefHTML(r);}catch(e){el.innerHTML=errBox(e);}}
function kv(o){if(!o||typeof o!=='object')return'';const e=Array.isArray(o)?o.map((v,i)=>[i,v]):Object.entries(o);const c=e.filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`<span class="kv">${typeof k==='number'?'':`<i>${esc(k)}</i> `}${esc(typeof v==='object'?JSON.stringify(v):v)}</span>`).join('');return c?`<div class="kvs">${c}</div>`:'';}
const conf=c=>c?`<span class="conf c-${esc(c)}">${esc(c)}</span>`:'';
function xrefHTML(r){const refs=(r.crossRefs||[]).filter(c=>c&&c.number);
  return `<div class="xcard"><div class="pn"><b>${esc(r.part||'Part')}</b>${conf(r.confidence)}</div>
<div class="small muted">${esc([r.brand,r.type].filter(Boolean).join(' · '))} · <code>${esc(r.number||'')}</code></div>${kv(r.specs)}
${(r.fits||[]).length?`<p class="small"><span class="muted">Fits:</span> ${esc(r.fits.join('; '))}</p>`:''}
${refs.length?`<table class="xt"><thead><tr><th>Brand</th><th>Number</th><th>Type</th><th>Find it</th></tr></thead><tbody>${refs.map(c=>`<tr><td>${esc(c.brand)}${c.store?`<div class="small muted">${esc(c.store)}</div>`:''}</td><td><code>${esc(c.number)}</code> ${conf(c.confidence)}${c.notes?`<div class="small muted">${esc(c.notes)}</div>`:''}</td><td class="small">${esc(c.kind||'')}</td><td class="plinks col">${storeLinks(c.number,true)}</td></tr>`).join('')}</tbody></table>`:'<p class="muted small">No confident cross-references found.</p>'}
${r.warning?`<p class="warn">⚠ ${esc(r.warning)}</p>`:''}<div class="plinks">Search the original number: ${storeLinks(r.number||'')}${lnk(`https://partsouq.com/en/search/all?q=${qv(r.number||'')}`,'Partsouq')}</div></div>`;}

/* ---------- vehicle search ---------- */
async function runSearch(q,hint,extra={}){const my=++st.ver;saveRecent(q,hint);$('#choose').hidden=true;$('#result').hidden=true;status('Identifying vehicle…',true);
  try{const r=await ask(idPrompt(q,hint),{json:true});if(my!==st.ver)return;
    if(!r.found||!Array.isArray(r.engines)||!r.engines.length){status(esc(r.message||'Couldn’t identify that vehicle. Try adding the year, model or engine.'),false,true);return;}
    const vinM=(q.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)||[])[0];r.vinStr=(extra.vin||vinM||'').toUpperCase()||null;r.rego=extra.rego||null;
    st.vehicle=r;status('');renderChoices(r);if(r.engines.length===1)chooseEngine(r.engines[0]);}
  catch(e){if(my!==st.ver)return;status(errBox(e),false,true);}}
function renderChoices(r){$('#choose').hidden=false;$('#chooseTitle').textContent=r.engines.length>1?`${r.vehicle}: which engine?`:r.vehicle;
  $('#chooseMsg').textContent=[r.vin?.decoded?`VIN: ${r.vin.decoded} (${r.vin.confidence||'?'} confidence)`:'',r.message||''].filter(Boolean).join(' · ');
  $('#engList').innerHTML=r.engines.map((e,i)=>`<button class="eng" data-i="${i}" type="button"><b>${esc(e.label)}</b><span>${esc([e.years,e.notes].filter(Boolean).join(' · '))}</span></button>`).join('');
  $$('#engList .eng').forEach(b=>b.onclick=()=>chooseEngine(r.engines[+b.dataset.i]));}
function chooseEngine(e){const my=++st.ver;st.engine=e;st.spec=null;st.sel=null;st.pcache={};
  $$('#engList .eng').forEach(b=>b.classList.toggle('on',st.vehicle.engines[+b.dataset.i]===e));
  const res=$('#result');res.hidden=false;res.classList.remove('manual');const v=st.vehicle;
  $('#rTitle').textContent=v.vehicle;$('#rMarket').textContent=[e.label,v.series,v.market].filter(Boolean).join(' · ');
  $('#rIds').innerHTML=[v.vinStr?`VIN <code>${esc(v.vinStr)}</code>`:'',v.rego?`Rego <code>${esc(v.rego)}</code>`:''].filter(Boolean).join(' · ');
  $('#rOverview').innerHTML=skel('Pulling engine data…');
  $('#specs').innerHTML=skel('Loading specifications…');$('#uncertain').textContent='';$('#fluids').innerHTML=skel('Loading…');$('#service').innerHTML='';$('#torque').innerHTML='';$('#issues').innerHTML=skel('Loading…');$('#ans').innerHTML='';
  $('#psq').value='';$('#abbrHint').textContent='';renderCats();
  st.s=normSpec(guessFromLabel(e));renderDiagram();renderDetail();renderLinks();
  $('#result').scrollIntoView({behavior:'smooth',block:'start'});
  partSearch(null,CATS[0]);
  ask(specPrompt(),{json:true}).then(r=>{if(my!==st.ver)return;st.spec=r;st.s=normSpec(Object.assign(guessFromLabel(e),r.engine||{}));renderSpec();renderDiagram();renderDetail();renderLinks();})
    .catch(err=>{if(my!==st.ver)return;$('#rOverview').innerHTML='';$('#specs').innerHTML=errBox(err);$('#fluids').innerHTML='';$('#issues').innerHTML='';});}

/* ---------- whole-car parts search ---------- */
function renderCats(active){$('#cats').innerHTML=CATS.map(([n],i)=>`<button class="cat ${active===n?'on':''}" data-i="${i}" type="button">${esc(n)}</button>`).join('');
  $$('#cats .cat').forEach(b=>b.onclick=()=>partSearch(null,CATS[+b.dataset.i]));}
$('#psq').addEventListener('input',e=>{const h=expandAbbr(e.target.value);$('#abbrHint').textContent=h.length?'Reading as: '+h.join(' · '):'';});
$('#psf').addEventListener('submit',ev=>{ev.preventDefault();const q=$('#psq').value.trim();if(q)partSearch(q);});
async function partSearch(query,cat){if(!st.vehicle||st.vehicle.manual)return;const my=st.ver;const key=cat?'c:'+cat[0]:'q:'+query.toLowerCase();renderCats(cat?cat[0]:null);
  const el=$('#presults');const label=cat?cat[0]:`“${query}”`;
  if(st.pcache[key]){renderParts(st.pcache[key],label);return;}
  el.innerHTML=skel(`Finding ${label} for ${vshort()}… this can take 20–40 seconds`);
  try{const hints=query?expandAbbr(query):[];const r=await ask(partsPrompt(query?(query+(hints.length?` (${hints.join('; ')})`:'')):null,cat?`${cat[0]}: ${cat[1]}`:null),{json:true});
    if(my!==st.ver)return;st.pcache[key]=r;renderParts(r,label);}
  catch(e){if(my!==st.ver)return;el.innerHTML=errBox(e);}}
function renderParts(r,label){const items=(r.items||[]).filter(Boolean);st.pitems=items;const el=$('#presults');
  if(!items.length){el.innerHTML=`<p class="muted">Nothing found for ${esc(label)}. Try another wording or a category.</p>`;return;}
  el.innerHTML=`<div class="rhead"><div><b>${esc(label)}</b> <span class="muted small">${items.length} parts</span>${r.interpreted?`<div class="small muted">${esc(r.interpreted)}</div>`:''}</div><button class="btn sm" data-act="copyall" type="button">Copy all</button></div>
${r.tips?`<p class="warn">ℹ ${esc(r.tips)}</p>`:''}${items.map(partHTML).join('')}`;}
function partHTML(p,i){const oem=(Array.isArray(p.oem)?p.oem:p.oem?[p.oem]:[]).filter(Boolean);p.oem=oem;const refs=(p.crossRefs||[]).filter(c=>c&&c.number);
  return `<div class="pcard" data-i="${i}"><div class="pn"><b>${esc(p.name)}</b>${p.position?`<span class="pos">${esc(p.position)}</span>`:''}${p.qty?`<span class="qty">×${esc(p.qty)}</span>`:''}${conf(p.confidence)}</div>
${kv(p.specs)}
<div class="nums"><div class="numrow"><span class="nlab">OEM</span>${oem.length?oem.map(n=>`<code>${esc(n)}</code>`).join(' '):'<span class="muted small">not confirmed, check by VIN</span>'}${oem.length?`<span class="plinks">${lnk(`https://partsouq.com/en/search/all?q=${qv(oem[0])}`,'Partsouq')}${lnk(ebay(oem[0]),'eBay')}<button class="linkbtn" data-act="xref" data-n="${esc(oem[0])}" type="button">Cross-ref</button></span>`:''}</div>
${refs.map(c=>`<div class="numrow"><span class="nlab">${esc(c.brand)}</span><code>${esc(c.number)}</code>${c.store?`<span class="small muted">${esc(c.store)}</span>`:''}<span class="plinks">${storeLinks(c.number,true)}</span>${c.notes?`<div class="small muted full">${esc(c.notes)}</div>`:''}</div>`).join('')}</div>
${p.notes?`<div class="pnote">${esc(p.notes)}</div>`:''}
<div class="plinks">Search stores: ${storeLinks(`${vshort()} ${p.position||''} ${p.name}`.replace(/\s+/g,' '))}</div>
<div class="pact">${liveOn()?`<button class="btn sm" data-act="live" type="button">Find live listings</button>`:''}<button class="btn sm ghost" data-act="copy" type="button">Copy</button></div><div class="pout"></div></div>`;}
const partText=p=>[`${p.name}${p.position?' ('+p.position+')':''}${p.qty?' x'+p.qty:''}`,p.oem?.length?`  OEM: ${p.oem.join(', ')}`:'',...(p.crossRefs||[]).filter(c=>c.number).map(c=>`  ${c.brand}: ${c.number}`),p.specs&&typeof p.specs==='object'?'  '+Object.entries(p.specs).map(([k,v])=>`${k}: ${v}`).join('; '):''].filter(Boolean).join('\n');
async function copyText(t,btn){const o=btn.textContent;try{await navigator.clipboard.writeText(t);btn.textContent='Copied';}catch(e){btn.textContent='Copy blocked';}setTimeout(()=>btn.textContent=o,1500);}
$('#presults').addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act;
  if(act==='copyall'){copyText(`${st.vehicle.vehicle}${st.vehicle.vinStr?' VIN '+st.vehicle.vinStr:''}\n\n`+st.pitems.map(partText).join('\n\n'),b);return;}
  const card=b.closest('.pcard'),p=st.pitems[+card.dataset.i],out=card.querySelector('.pout');
  if(act==='copy')copyText(`${vshort()}\n`+partText(p),b);
  else if(act==='xref')xref(b.dataset.n,ctxLine(),out);
  else if(act==='live'){b.disabled=true;out.innerHTML=skel('Searching Australian retailers…');
    try{const r=await ask(listingPrompt(p),{json:true,web:true});const ls=(r.listings||[]).filter(l=>l&&/^https?:\/\//.test(l.url||''));
      out.innerHTML=ls.length?`<div class="listings">${ls.map(l=>`<a class="lk" href="${esc(l.url)}" target="_blank" rel="noopener"><b>${esc(l.store)} ↗</b><span>${esc(l.title)}</span><span class="mono">${esc([l.partNumber,l.price].filter(Boolean).join(' · '))}</span></a>`).join('')}</div>${r.note?`<p class="small muted">${esc(r.note)}</p>`:''}`:`<p class="muted small">No listings found. ${esc(r.note||'')}</p>`;}
    catch(err){out.innerHTML=errBox(err);}b.disabled=false;}});

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

/* ---------- settings panel ---------- */
function openSettings(){$('#sGem').value=cfg.geminiKey||'';const pv=cfg.provider||'gemini';$$('input[name=prov]').forEach(r=>r.checked=r.value===pv);provUI();$('#sKey').value=cfg.apiKey||'';$('#sModel').value=cfg.model||'claude-sonnet-5-5';$('#sLive').checked=!!cfg.live;$('#sReg').value=cfg.regcheck||'';$('#sClaude').hidden=!sample;$('#settings').hidden=false;}
$('#setBtn').onclick=openSettings;$('#aiBadge').onclick=openSettings;
$('#sClose').onclick=()=>$('#settings').hidden=true;
$('#settings').addEventListener('click',e=>{if(e.target.id==='settings')$('#settings').hidden=true;});
function provUI(){const pv=($$('input[name=prov]').find(r=>r.checked)||{}).value||'gemini';$('#pGem').hidden=pv!=='gemini';$('#pAnt').hidden=pv!=='anthropic';}
$$('input[name=prov]').forEach(r=>r.onchange=provUI);
$('#sSave').onclick=()=>{cfg.provider=($$('input[name=prov]').find(r=>r.checked)||{}).value||'gemini';cfg.geminiKey=$('#sGem').value.trim();cfg.apiKey=$('#sKey').value.trim();cfg.model=$('#sModel').value;cfg.live=$('#sLive').checked;cfg.regcheck=$('#sReg').value.trim();saveCfg();$('#settings').hidden=true;};
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
