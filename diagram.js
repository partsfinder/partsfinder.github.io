
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mod=(a,b)=>((a%b)+b)%b;
const f1=v=>(+v).toFixed(1);
const cap=s=>s?s[0].toUpperCase()+s.slice(1):'';
const R=28,L=95;
const st={view:'section',running:!matchMedia('(prefers-reduced-motion: reduce)').matches,speed:35,th:0,last:0,banks:[],s:null,fo:[],vehicle:null,engine:null,spec:null,parts:null,sel:null,pfilter:'all',ver:0,cache:{},svg:null,lastFire:null};
const E=id=>st.cache[id]!==undefined?st.cache[id]:(st.cache[id]=document.getElementById(id));

const COMPS={block:'Engine block',head:'Cylinder head',piston:'Pistons & rings',conrod:'Connecting rods',crank:'Crankshaft',camshaft:'Camshafts',valves:'Valves & springs',timing:'Timing drive',sparkplug:'Spark plugs & coils',glowplug:'Glow plugs',injector:'Fuel injectors',intake:'Intake & throttle',exhaust:'Exhaust manifold',turbo:'Turbo / supercharger',intercooler:'Intercooler',oil:'Lubrication',cooling:'Cooling system',accessory:'Accessory drive',sensors:'Sensors',gaskets:'Gaskets & seals',rotor:'Rotor & apex seals',battery:'HV battery',inverter:'Inverter',motor:'Electric motor',reducer:'Reduction gearbox',other:'Other'};
const GEN={block:'The main casting. It holds the cylinder bores, coolant jackets and the crankshaft main bearings.',head:'Bolts on top of the block. It holds the valves, camshafts, ports and plugs, and forms the roof of each combustion chamber.',piston:'Slides in the bore. The rings seal compression and scrape oil back down off the cylinder wall.',conrod:'Links each piston to the crankshaft, turning up-and-down motion into rotation.',crank:'Turns piston motion into rotation. It carries counterweights and spins in the main bearings.',camshaft:'Lobes push the valves open in time with the pistons. The cams turn at half crank speed.',valves:'Intake valves let air in and exhaust valves let burnt gas out. Springs snap them shut.',timing:'A belt, chain or gears keep the cams in sync with the crank. If it fails on an interference engine, the valves can hit the pistons.',sparkplug:'Coil-on-plug ignition: each coil builds a high-voltage spark across the plug gap to light the mixture.',glowplug:'Pre-heats the combustion chamber so a diesel can start from cold.',injector:'Sprays fuel into the intake port (port injection) or straight into the cylinder (direct injection).',intake:'The air filter, throttle body, plenum and runners that feed air to each cylinder.',exhaust:'Collects hot gas from each exhaust port and sends it to the turbo or the catalytic converter.',turbo:'Exhaust gas spins a turbine that drives a compressor, forcing extra air into the engine. A supercharger does the same job but is belt-driven.',intercooler:'Cools the compressed charge air so it is denser and less prone to knock.',oil:'The sump holds the oil. The pump pushes it through the filter to the bearings, cams, chain tensioner and turbo.',cooling:'The water pump circulates coolant through the block and head jackets. The thermostat holds the engine at operating temperature.',accessory:'A serpentine belt from the crank pulley drives the alternator, A/C compressor and sometimes the water pump. A tensioner keeps it tight.',sensors:'Crank and cam position, knock, O2, MAP/MAF and temperature sensors feed the ECU.',gaskets:'The head gasket, cam cover gasket and crank seals keep compression, oil and coolant apart.',rotor:'A triangular rotor orbits inside the housing. Apex seals at each tip split it into three working chambers.',battery:'The high-voltage traction battery that stores energy for the motor.',inverter:'Turns battery DC into three-phase AC for the motor, and back again during regen braking.',motor:'Stator windings make a rotating magnetic field that drags the rotor around.',reducer:'Single-speed reduction gears and the differential that drive the wheels.',other:'Other engine parts.'};

/* ---------- spec normalising ---------- */
function normSpec(e){const s=Object.assign({},e||{});let lay=String(s.layout||'inline').toLowerCase();const fuel=String(s.fuel||'petrol').toLowerCase();
  if(/elec/.test(lay)||(/^electric/.test(fuel)&&!(+s.cylinders>0)))lay='electric';else if(/rot|wankel/.test(lay))lay='rotary';else if(/flat|boxer|horiz|opposed/.test(lay))lay='flat';else if(/^(v|w|vr)/.test(lay))lay='v';else lay='inline';
  s.layout=lay;s.cylinders=parseInt(s.cylinders)||({inline:4,v:6,flat:4,rotary:2,electric:0}[lay]);
  if(lay==='v'){let a=parseFloat(s.vAngle)||(s.cylinders===8?90:60);if(a>=150){s.layout='flat';}s.drawAngle=Math.max(30,Math.min(120,a));s.vAngle=a;}
  const vt=String(s.valvetrain||'DOHC').toUpperCase();s.vt=/OHV|PUSH/.test(vt)?'OHV':/SOHC/.test(vt)?'SOHC':'DOHC';
  const asp=String(s.aspiration||'').toLowerCase();s.turbo=/turbo/.test(asp);s.twin=/twin|bi|sequential/.test(asp);s.super=/super/.test(asp);
  s.diesel=/diesel/.test(fuel);s.hybrid=/hybrid/.test(fuel);
  const inj=String(s.injection||'').toLowerCase();s.di=s.diesel||/direct|gdi|common|tdi|dual|d-4s|tsi|fsi/.test(inj);s.pi=!s.diesel&&(/port|mpi|multi|dual|d-4s|efi|sfi/.test(inj)||!s.di);
  const t=String(s.timingDrive||'').toLowerCase();s.td=/belt/.test(t)?'belt':/gear/.test(t)?'gear':'chain';
  return s;}
function guessFromLabel(e){const t=((e.label||'')+' '+(e.code||'')+' '+(e.fuel||'')).toLowerCase();const g={fuel:e.fuel||'petrol'};
  if(/electric|\bev\b|kwh/.test(t)&&!/hybrid/.test(t)){g.layout='electric';return g;}
  if(/rotary|wankel|13b|20b|renesis/.test(t)){g.layout='rotary';return g;}
  let m=t.match(/\bv(\d{1,2})\b/);if(m){g.layout='V';g.cylinders=+m[1];}
  else if(/boxer|flat|\bh4\b|\bh6\b|fa20|fb2|ej2/.test(t)){g.layout='flat';m=t.match(/\bh(\d)\b/);g.cylinders=m?+m[1]:4;}
  else{m=t.match(/\b(?:i|l|inline[- ]?)(\d)\b/)||t.match(/(\d)[- ]?cyl/);g.layout='inline';const d=parseFloat((t.match(/(\d\.\d)\s*l?/)||[])[1]);g.cylinders=m?+m[1]:(d&&d<1.3?3:d>3.6?6:4);}
  if(/turbo|tsi|tfsi|ecoboost|\bt\b|d-4d|crdi|tdi|dci/.test(t))g.aspiration='turbo';if(/diesel|tdi|crdi|d-4d|dci|ftv/.test(t))g.fuel='diesel';
  return g;}
function firing(s){const n=s.cylinders;const fo=(String(s.firingOrder||'').match(/\d+/g)||[]).map(Number);if(fo.length===n&&new Set(fo).size===n&&Math.max(...fo)===n)return fo;
  const d={1:[1],2:[1,2],3:[1,2,3],4:s.layout==='flat'?[1,3,2,4]:[1,3,4,2],5:[1,2,4,5,3],6:s.layout==='inline'?[1,5,3,6,2,4]:[1,4,2,5,3,6],8:[1,5,4,8,6,3,7,2],10:[1,6,5,10,2,7,3,8,4,9],12:[1,7,5,11,3,9,6,12,2,8,4,10]};
  return d[n]||Array.from({length:n},(_,i)=>i+1);}
function bankList(s){if(s.layout==='v'){const a=s.drawAngle/2;return[{a:-a,m:-1},{a:a,m:1}];}if(s.layout==='flat')return[{a:-90,m:-1},{a:90,m:1}];return[{a:0,m:1}];}
const TX=(lx,ly,b)=>{const a=b.a*Math.PI/180,x=lx*b.m;return[x*Math.cos(a)-ly*Math.sin(a),x*Math.sin(a)+ly*Math.cos(a)];};

const DEFS=`<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#29313c"/><line x1="0" y1="0" x2="0" y2="7" stroke="#3b4553" stroke-width="1.6"/></pattern><radialGradient id="gFlame"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffb02e"/><stop offset="1" stop-color="#ff5a1f"/></radialGradient></defs>`;
function zig(x,y1,y2){const p=[],n=8;for(let k=0;k<=n;k++){const y=y1+(y2-y1)*k/n;const xx=(k===0||k===n)?x:(k%2?x-6:x+6);p.push(xx+','+f1(y));}return p.join(' ');}
function blades(r1,r2,n){let d='';for(let k=0;k<n;k++){const a=k*2*Math.PI/n;d+=`M${f1(r1*Math.cos(a))},${f1(r1*Math.sin(a))}L${f1(r2*Math.cos(a+.5))},${f1(r2*Math.sin(a+.5))}`;}return d;}
function bboxView(pts,pad){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;pts.forEach(([x,y])=>{x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);});return `${f1(x0-pad)} ${f1(y0-pad)} ${f1(x1-x0+2*pad)} ${f1(y1-y0+2*pad)}`;}

/* ---------- cross-section ---------- */
const CAM='M-9,0 A9,9 0 0,0 9,0 L5,-11 Q0,-17 -5,-11 Z';
function bankSVG(i,s){let o='';
  o+=`<g class="comp" data-c="block"><path class="metal" d="M-72,-150 L-72,-48 L-50,-26 L50,-26 L72,-48 L72,-150 Z"/><rect class="bore" x="-40" y="-150" width="80" height="112"/></g>`;
  o+=`<rect id="gas${i}" class="gas" x="-40" y="-150" width="80" height="10"/>`;
  o+=`<g class="comp" data-c="cooling"><rect class="coolant" x="-65" y="-146" width="14" height="66" rx="4"/><rect class="coolant" x="51" y="-146" width="14" height="66" rx="4"/></g>`;
  o+=`<g class="comp" data-c="piston"><g id="pis${i}"><rect class="pist" x="-38" y="-26" width="76" height="42" rx="3"/><line class="ring" x1="-38" y1="-19" x2="38" y2="-19"/><line class="ring" x1="-38" y1="-13" x2="38" y2="-13"/><line class="ring" x1="-38" y1="-7" x2="38" y2="-7"/><circle class="pin" r="6"/></g></g>`;
  o+=`<g class="comp" data-c="head"><path class="metal" d="M-76,-150 L76,-150 L76,-250 L-76,-250 Z"/><path class="cover" d="M-70,-250 L70,-250 L62,-280 L-62,-280 Z"/><path id="ch${i}" class="chamber" d="M-40,-150 Q0,-182 40,-150 Z"/></g>`;
  o+=`<g class="comp" data-c="cooling"><rect class="coolant" x="-72" y="-246" width="11" height="28" rx="4"/><rect class="coolant" x="61" y="-246" width="11" height="28" rx="4"/></g>`;
  o+=`<g class="comp" data-c="intake"><path class="port in" d="M-22,-168 C-30,-190 -50,-198 -76,-200"/></g><g class="comp" data-c="exhaust"><path class="port ex" d="M22,-168 C30,-190 50,-198 76,-200"/></g>`;
  const valve=(id,x,cls)=>`<g id="${id}"><line class="stem" x1="${x}" y1="-160" x2="${x}" y2="-240"/><path class="vhead ${cls}" d="M${x-13},-155 L${x+13},-155 L${x+3},-164 L${x-3},-164 Z"/><rect class="bucket" x="${x-7}" y="-244" width="14" height="7" rx="1"/></g>`;
  o+=`<g class="comp" data-c="valves"><polyline class="spring" points="${zig(-20,-204,-236)}"/><polyline class="spring" points="${zig(20,-204,-236)}"/>${valve('iv'+i,-20,'in')}${valve('ev'+i,20,'ex')}</g>`;
  if(s.diesel){o+=`<g class="comp" data-c="injector"><rect class="injector" x="-5" y="-302" width="10" height="140" rx="2"/><path class="spray" id="spray${i}" d="M0,-157 L-17,-143 L17,-143 Z"/></g><g class="comp" data-c="glowplug"><line class="glow" x1="40" y1="-262" x2="13" y2="-162"/><circle class="glowtip" cx="13" cy="-161" r="4"/></g>`;}
  else{o+=`<g class="comp" data-c="sparkplug"><rect class="plug" x="-4" y="-284" width="8" height="124"/><rect class="plughex" x="-8" y="-266" width="16" height="12"/><rect class="coil" x="-11" y="-310" width="22" height="30" rx="3"/><circle id="sp${i}" class="spark" cx="0" cy="-160" r="7"/></g>`;
    let inj='';if(s.di)inj+=`<line class="injline" x1="-62" y1="-238" x2="-34" y2="-163"/>`;if(s.pi)inj+=`<line class="injline" x1="-112" y1="-250" x2="-87" y2="-208"/>`;
    const sp=s.di?'M-34,-162 L-18,-151 L-29,-145 Z':'M-86,-206 L-72,-196 L-81,-191 Z';
    o+=`<g class="comp" data-c="injector">${inj}<path class="spray" id="spray${i}" d="${sp}"/></g>`;}
  if(s.vt==='DOHC'){o+=`<g class="comp" data-c="camshaft"><g transform="translate(-20,-254)"><g id="ci${i}"><path class="cam" d="${CAM}"/><circle class="pin" r="3"/></g></g><g transform="translate(20,-254)"><g id="ce${i}"><path class="cam" d="${CAM}"/><circle class="pin" r="3"/></g></g></g>`;}
  else if(s.vt==='SOHC'){o+=`<g class="comp" data-c="camshaft"><line class="rocker" x1="-22" y1="-246" x2="-6" y2="-256"/><line class="rocker" x1="22" y1="-246" x2="6" y2="-256"/><g transform="translate(0,-262)"><g id="ci${i}"><path class="cam" d="${CAM}"/><circle class="pin" r="3"/></g></g></g>`;}
  else{o+=`<g class="comp" data-c="camshaft"><g transform="translate(-56,-60)"><g id="ci${i}"><path class="cam" d="${CAM}"/><circle class="pin" r="3"/></g></g><line class="pushrod" x1="-56" y1="-70" x2="-46" y2="-250"/><line class="rocker" x1="-50" y1="-254" x2="-18" y2="-247"/><circle class="pin" cx="-34" cy="-255" r="3"/></g>`;}
  o+=`<g class="comp" data-c="intake"><path class="runner" d="M-76,-200 C-100,-202 -112,-214 -132,-226"/><rect class="plenum" x="-184" y="-264" width="54" height="78" rx="12"/><circle class="throttle" cx="-157" cy="-225" r="14"/><line class="tplate" x1="-167" y1="-233" x2="-147" y2="-217"/></g>`;
  if(s.super&&i===0)o+=`<g class="comp" data-c="turbo"><rect class="blower" x="-196" y="-306" width="66" height="36" rx="8"/><circle class="pin" cx="-176" cy="-288" r="9"/><circle class="pin" cx="-150" cy="-288" r="9"/></g>`;
  const hasT=s.turbo&&(i===0||s.twin);
  o+=`<g class="comp" data-c="exhaust"><path class="header" d="M76,-200 C100,-200 112,-190 114,-170 L114,${hasT?-128:-60}"/></g>`;
  if(hasT)o+=`<g class="comp" data-c="turbo"><circle class="turbine" cx="134" cy="-104" r="27"/><circle class="turbine" cx="134" cy="-104" r="13" style="fill:#2a1d17"/><g id="tw${i}" transform="translate(134,-104)"><path class="blades" d="${blades(3,11,7)}"/></g><path class="header" d="M150,-82 L158,-50"/></g>`;
  o+=`<g class="comp" data-c="sensors"><path class="sensor" d="M-80,-110 l7,-4 7,4 0,8 -7,4 -7,-4 Z"/><rect class="sensor" x="120" y="-160" width="16" height="8" rx="2"/></g>`;
  o+=`<g class="comp" data-c="gaskets"><rect class="gasket" x="-76" y="-152" width="152" height="4"/><rect class="gasket" x="-70" y="-252" width="140" height="3"/></g>`;
  return o;}
function crankcaseSVG(){return `<g class="comp" data-c="block"><path class="metal" d="M-80,-40 L-80,30 Q-80,46 -64,46 L64,46 Q80,46 80,30 L80,-40 Q40,-64 0,-64 Q-40,-64 -80,-40 Z"/><circle class="bore" r="50"/></g>
<g class="comp" data-c="oil"><path class="sump" d="M-82,46 L82,46 L72,106 L-72,106 Z"/><path class="oilfill" d="M-77,80 Q-40,74 0,80 T77,80 L73,104 L-73,104 Z"/><path class="pickup" d="M-24,98 L-24,70 Q-24,58 -10,52"/><g transform="translate(44,30)"><circle class="pump" r="12"/><g id="opg"><path class="gear" d="${blades(0,9,6).replace(/L/g,' L')}" style="stroke:#c99a2e;stroke-width:3"/></g></g></g>
<g class="comp" data-c="sensors"><rect class="sensor" x="80" y="-8" width="14" height="10" rx="2"/></g>`;}
function crankSVG(){return `<g class="comp" data-c="crank"><g id="crk"><path class="web" d="M-32,8 Q-36,42 0,48 Q36,42 32,8 L14,-${R} A14,14 0 0,0 -14,-${R} Z"/><circle class="journal" r="15"/><circle class="cpin" cy="-${R}" r="11"/></g></g>`;}
function sectionSVG(s){if(s.layout==='rotary')return rotarySVG(s);if(s.layout==='electric')return evSVG(s);
  const banks=bankList(s);st.banks=banks;const pts=[[-92,-66],[96,110]];
  banks.forEach(b=>[[-200,-20],[175,-20],[175,-314],[-200,-314]].forEach(p=>pts.push(TX(p[0],p[1],b))));
  let o=`<svg viewBox="${bboxView(pts,10)}" xmlns="http://www.w3.org/2000/svg">${DEFS}${crankcaseSVG()}`;
  banks.forEach((b,i)=>{o+=`<g transform="rotate(${b.a}) scale(${b.m},1)">${bankSVG(i,s)}</g>`;});
  o+=crankSVG();
  banks.forEach((b,i)=>{o+=`<g transform="rotate(${b.a}) scale(${b.m},1)"><g class="comp" data-c="conrod"><line id="rod${i}" class="rod" x1="0" y1="0" x2="0" y2="-90"/><circle id="rbe${i}" r="13" class="rodend"/><circle id="rse${i}" r="8" class="rodend"/></g></g>`;});
  return o+'</svg>';}
function updSection(th){const s=st.s;E('crk')?.setAttribute('transform',`rotate(${f1(mod(th,360))})`);E('opg')?.setAttribute('transform',`rotate(${f1(th*1.5)})`);let label='';
  st.banks.forEach((b,i)=>{const tp=th-b.a,rad=tp*Math.PI/180,sn=Math.sin(rad),cs=Math.cos(rad);
    const px=b.m*R*sn,py=-R*cs,pinY=-(R*cs+Math.sqrt(L*L-R*R*sn*sn));
    E('pis'+i)?.setAttribute('transform',`translate(0,${f1(pinY)})`);
    const rod=E('rod'+i);if(rod){rod.setAttribute('x1',f1(px));rod.setAttribute('y1',f1(py));rod.setAttribute('y2',f1(pinY));}
    E('rbe'+i)?.setAttribute('transform',`translate(${f1(px)},${f1(py)})`);E('rse'+i)?.setAttribute('transform',`translate(0,${f1(pinY)})`);
    const phi=mod(tp+(i?360:0),720);
    const li=phi<190?7*Math.sin(Math.PI*phi/190):0,le=phi>530?7*Math.sin(Math.PI*(phi-530)/190):0;
    E('iv'+i)?.setAttribute('transform',`translate(0,${f1(li)})`);E('ev'+i)?.setAttribute('transform',`translate(0,${f1(le)})`);
    E('ci'+i)?.setAttribute('transform',`rotate(${f1(phi/2+132.5)})`);E('ce'+i)?.setAttribute('transform',`rotate(${f1(phi/2-132.5)})`);
    const sn2=phi<180?'intake':phi<360?'compression':phi<540?'power':'exhaust';
    const gas=E('gas'+i);if(gas){gas.setAttribute('height',f1(Math.max(0,pinY+124)));gas.setAttribute('class','gas '+sn2);}
    E('ch'+i)?.setAttribute('class','chamber'+(phi>=358&&phi<430?' burn':''));
    E('sp'+i)?.setAttribute('class','spark'+(phi>=350&&phi<367?' on':''));
    const on=s.diesel?(phi>=348&&phi<385):s.di?(phi>=40&&phi<120):(phi<100);E('spray'+i)?.setAttribute('class','spray'+(on?' on':''));
    E('tw'+i)?.setAttribute('transform',`translate(134,-104) rotate(${f1(th*4)})`);
    if(i===0)label=`Cyl 1 · ${cap(sn2)} stroke`;});
  setStroke(label);}

/* ---------- rotary ---------- */
function rotarySVG(){let d='';for(let k=0;k<=120;k++){const a=k/120*2*Math.PI;d+=(k?'L':'M')+f1(110*Math.cos(a)+16*Math.cos(3*a))+','+f1(110*Math.sin(a)+16*Math.sin(3*a));}
  return `<svg viewBox="-195 -190 390 350" xmlns="http://www.w3.org/2000/svg">${DEFS}
<g class="comp" data-c="intake"><rect x="-82" y="-180" width="30" height="100" class="plenum"/></g><g class="comp" data-c="exhaust"><path class="header" d="M60,-88 L60,-176"/></g>
<g class="comp" data-c="block"><path class="metal" fill-rule="evenodd" d="M-160,-140 h320 v280 h-320 Z ${d}Z"/></g>
<g class="comp" data-c="cooling"><circle class="coolant" cx="-140" cy="-120" r="9"/><circle class="coolant" cx="140" cy="-120" r="9"/><circle class="coolant" cx="-140" cy="120" r="9"/><circle class="coolant" cx="140" cy="120" r="9"/><circle class="coolant" cx="-148" cy="0" r="8"/><circle class="coolant" cx="148" cy="0" r="8"/></g>
<path d="${d}Z" class="bore" style="fill:#0c1117"/>
<g class="comp" data-c="rotor"><path id="rotor" class="rotorp" d=""/><circle id="rotc" class="bore" r="30" style="fill:#3a4452"/></g>
<g class="comp" data-c="crank"><g id="ecc"><circle class="web" cx="16" r="22"/></g><circle class="journal" r="12"/></g>
<g class="comp" data-c="sparkplug"><rect class="plug" x="-24" y="94" width="8" height="54"/><rect class="plug" x="16" y="94" width="8" height="54"/><rect class="coil" x="-30" y="146" width="20" height="14" rx="3"/><rect class="coil" x="10" y="146" width="20" height="14" rx="3"/><circle id="sp0" class="spark" cx="-20" cy="94" r="7"/><circle id="sp1" class="spark" cx="20" cy="94" r="7"/></g>
<text class="svglab" x="-80" y="-184">INTAKE</text><text class="svglab" x="44" y="-180">EXHAUST</text></svg>`;}
function updRotary(th){const t=th*Math.PI/180,e=16,Rr=105,cx=e*Math.cos(t),cy=e*Math.sin(t),psi=t/3;
  const p=[0,1,2].map(k=>[cx+Rr*Math.cos(psi+2*Math.PI*k/3),cy+Rr*Math.sin(psi+2*Math.PI*k/3)]);
  let d=`M${f1(p[0][0])},${f1(p[0][1])}`;for(let k=0;k<3;k++){const a=p[k],b=p[(k+1)%3],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;d+=` Q${f1(mx+(mx-cx)*.25)},${f1(my+(my-cy)*.25)} ${f1(b[0])},${f1(b[1])}`;}
  E('rotor')?.setAttribute('d',d+'Z');E('rotc')?.setAttribute('transform',`translate(${f1(cx)},${f1(cy)})`);E('ecc')?.setAttribute('transform',`rotate(${f1(th)})`);
  const on=mod(th,360)<22;E('sp0')?.setAttribute('class','spark'+(on?' on':''));E('sp1')?.setAttribute('class','spark'+(mod(th-8,360)<16?' on':''));
  setStroke('Rotor turns at ⅓ of eccentric-shaft speed');}

/* ---------- EV ---------- */
function evSVG(){let slots='',cells='',mags='';for(let k=0;k<18;k++)slots+=`<rect class="slot" x="-4" y="-66" width="8" height="16" transform="rotate(${k*20})"/>`;
  for(let k=0;k<10;k++)cells+=`<rect class="cell" x="${-238+k*48}" y="84" width="40" height="34" rx="3"/>`;for(let k=0;k<4;k++)mags+=`<rect class="magnet" x="-5" y="-38" width="10" height="14" transform="rotate(${k*90})"/>`;
  return `<svg viewBox="-270 -170 540 310" xmlns="http://www.w3.org/2000/svg">${DEFS}
<g class="comp" data-c="cooling"><path class="cloop" d="M-200,-60 L-200,-150 L120,-150 L120,-70"/></g>
<g class="comp" data-c="battery"><rect class="batt" x="-250" y="72" width="500" height="58" rx="8"/>${cells}</g>
<g class="comp" data-c="inverter"><path class="hv" d="M190,72 L190,-110 L104,-110"/><path class="hv" d="M-44,-112 L-110,-112 L-110,-92"/><rect class="inv" x="-44" y="-138" width="148" height="56" rx="6"/><text class="svglab" x="-10" y="-105">INVERTER</text></g>
<g class="comp" data-c="motor"><g transform="translate(-110,-10)"><circle class="stator" r="72"/>${slots}<g id="evr"><circle class="mrotor" r="42"/>${mags}<circle class="hub" r="6"/></g></g></g>
<g class="comp" data-c="reducer"><line class="shaft" x1="-110" y1="-10" x2="10" y2="-10"/><g transform="translate(10,-10)"><g id="g1"><circle class="gearc" r="26"/></g></g><g transform="translate(78,8)"><g id="g2"><circle class="gearc" r="42"/></g></g><line class="shaft" x1="78" y1="8" x2="250" y2="8"/></g>
<text class="svglab" x="-150" y="-96">MOTOR</text><text class="svglab" x="40" y="62">REDUCTION GEAR</text><text class="svglab" x="-60" y="148">HIGH-VOLTAGE BATTERY</text></svg>`;}
function updEV(th){E('evr')?.setAttribute('transform',`rotate(${f1(th*2)})`);E('g1')?.setAttribute('transform',`rotate(${f1(th*2)})`);E('g2')?.setAttribute('transform',`rotate(${f1(-th*2*26/42)})`);setStroke('Electric drive unit');}

/* ---------- top layout ---------- */
function topSVG(s){const n=Math.max(1,s.cylinders),two=s.layout!=='inline',per=two?Math.ceil(n/2):n,pitch=58,len=per*pitch+10;
  const BY=two?[-70,70]:[0],BX=two?[0,s.layout==='v'?22:30]:[0],end=len+(two?BX[1]:0);
  let head='',cyl='',coil='',inj='',cam='',inR='',exR='',tur='',sens='',oil='',cool='';let num=1;
  BY.forEach((by,bi)=>{const bx=BX[bi],count=two?(bi===0?per:n-per):n,far=two?(bi===0?-1:1):-1,w=count*pitch+10;
    head+=`<rect class="metal" x="${bx}" y="${by-38}" width="${w}" height="76" rx="8"/>`;
    if(s.vt==='DOHC')cam+=`<line class="camline" x1="${bx+8}" y1="${by-14}" x2="${bx+w-8}" y2="${by-14}"/><line class="camline" x1="${bx+8}" y1="${by+14}" x2="${bx+w-8}" y2="${by+14}"/>`;
    else if(s.vt==='SOHC')cam+=`<line class="camline" x1="${bx+8}" y1="${by}" x2="${bx+w-8}" y2="${by}"/>`;
    for(let k=0;k<count;k++){const cx=bx+34+k*pitch;
      cyl+=`<circle id="cy${num}" class="cyl" cx="${cx}" cy="${by}" r="20"/><text class="cyltext" x="${cx}" y="${by}">${num}</text>`;
      if(s.diesel)inj+=`<circle class="injt" cx="${cx+15}" cy="${by-17}" r="5"/>`;else{coil+=`<rect class="coilt" x="${cx+9}" y="${by-27}" width="13" height="13" rx="2"/>`;inj+=`<circle class="injt" cx="${cx-14}" cy="${by-far*30}" r="4"/>`;}
      exR+=`<path class="pipe-ex" d="M${cx},${by+far*38} L${cx},${by+far*66} Q${cx},${by+far*76} ${cx+12},${by+far*76}"/>`;
      inR+=two?`<line class="pipe-in" x1="${cx}" y1="${by-far*38}" x2="${cx}" y2="${by-far*48}"/>`:`<line class="pipe-in" x1="${cx}" y1="${by+38}" x2="${cx}" y2="${by+80}"/>`;
      num++;}
    const cy=by+far*76;const tail=s.turbo?(two&&!s.twin?end+70:end+40):end+70;
    exR+=`<line class="pipe-ex" x1="${bx+34}" y1="${cy}" x2="${tail}" y2="${cy}"/>`;
    sens+=`<rect class="sensor" x="${bx+w-24}" y="${cy+(far<0?-14:6)}" width="8" height="8" rx="1"/>`;});
  let plen,thr,air='',ic='',txt='';
  if(!two){plen=`<rect class="plenum" x="10" y="80" width="${len-20}" height="34" rx="14"/>`;thr=`<circle class="throttle" cx="-6" cy="97" r="13"/><line class="tplate" x1="-14" y1="89" x2="2" y2="105"/>`;
    if(s.turbo){tur=`<circle class="turbine" cx="${len+40}" cy="-76" r="20"/><path class="pipe-ex" d="M${len+52},-62 L${len+66},-40"/>`;air=`<rect class="airbox" x="${len+64}" y="-136" width="34" height="30" rx="4"/><path class="pipe-in" d="M${len+70},-106 L${len+50},-94"/>`;
      ic=`<path class="pipe-in" d="M${len+34},-56 L${len+34},12"/><rect class="ic" x="${len+20}" y="12" width="28" height="92" rx="3"/><path class="pipe-in" d="M${len+34},104 L${len+34},136 L-6,136 L-6,110"/>`;}
    else air=`<path class="pipe-in" d="M-19,97 L-56,97"/><rect class="airbox" x="-96" y="80" width="40" height="34" rx="4"/><path class="sensor" d="M-40,91 l6,6 -6,6 -6,-6 Z"/>`;
    txt=`<text class="svglab" x="14" y="128">INTAKE</text><text class="svglab" x="40" y="-88">EXHAUST</text>`;}
  else{plen=`<rect class="plenum" x="14" y="-24" width="${end-14}" height="48" rx="14"/>`;thr=`<circle class="throttle" cx="${end+18}" cy="0" r="13"/><line class="tplate" x1="${end+10}" y1="-8" x2="${end+26}" y2="8"/>`;
    const tx=end+70;
    if(s.turbo){if(s.twin)tur=`<circle class="turbine" cx="${tx}" cy="-146" r="20"/><circle class="turbine" cx="${tx}" cy="146" r="20"/>`;else tur=`<path class="pipe-ex" d="M${tx},-146 L${tx},124"/><circle class="turbine" cx="${tx}" cy="146" r="20"/>`;
      ic=`<rect class="ic" x="${end+96}" y="-46" width="26" height="92" rx="3"/><path class="pipe-in" d="M${tx+14},${s.twin?-130:130} L${end+109},${s.twin?-46:46}"/>${s.twin?`<path class="pipe-in" d="M${tx+14},130 L${end+109},46"/>`:''}<path class="pipe-in" d="M${end+96},0 L${end+31},0"/>`;}
    else air=`<path class="pipe-in" d="M${end+31},0 L${end+60},0"/><rect class="airbox" x="${end+60}" y="-20" width="36" height="40" rx="4"/>`;
    txt=`<text class="svglab" x="22" y="4">INTAKE</text><text class="svglab" x="40" y="-158">EXHAUST</text>`;}
  const tc=two?`<rect class="tcover" x="-30" y="-110" width="26" height="220" rx="6"/>`:`<rect class="tcover" x="-30" y="-42" width="26" height="84" rx="6"/>`;
  cool=`<circle class="coolant" cx="-17" cy="${two?34:22}" r="9"/><rect class="coolant" x="2" y="${two?-10:-50}" width="14" height="12" rx="3"/>`;
  oil=`<circle class="filt" cx="-56" cy="${two?-86:-62}" r="12"/>`;
  const acc=`<rect class="acc" x="-64" y="-36" width="22" height="30" rx="4"/><rect class="acc" x="-64" y="4" width="22" height="32" rx="4"/><rect class="acc" x="-40" y="-44" width="6" height="88" rx="3" style="fill:#0a0d12"/><text class="svglab" x="-90" y="-22">ALT</text><text class="svglab" x="-90" y="24">A/C</text>`;
  const vb=two?`-100 -186 ${end+(s.turbo?240:200)} 372`:`-104 -146 ${len+(s.turbo?214:190)} 300`;
  return `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${DEFS}
<g class="comp" data-c="exhaust">${exR}</g>${tur?`<g class="comp" data-c="turbo">${tur}</g>`:''}
<g class="comp" data-c="intake">${inR}${plen}${thr}${air}</g>${ic?`<g class="comp" data-c="intercooler">${ic}</g>`:''}
<g class="comp" data-c="head">${head}</g><g class="comp" data-c="camshaft">${cam}</g><g class="comp" data-c="piston">${cyl}</g>
${coil?`<g class="comp" data-c="sparkplug">${coil}</g>`:''}<g class="comp" data-c="injector">${inj}</g>
<g class="comp" data-c="timing">${tc}</g><g class="comp" data-c="cooling">${cool}</g><g class="comp" data-c="oil">${oil}</g><g class="comp" data-c="accessory">${acc}</g><g class="comp" data-c="sensors">${sens}</g>
<text class="svglab" x="-96" y="${two?-170:-130}">◀ FRONT</text>${txt}</svg>`;}
function updTop(th){const n=st.s.cylinders,fo=st.fo,seg=720/n,ph=mod(th,720),idx=Math.floor(ph/seg)%n,frac=(ph%seg)/seg,cyl=frac<.55?fo[idx]:null;
  if(st.lastFire!==cyl){if(st.lastFire)E('cy'+st.lastFire)?.setAttribute('class','cyl');if(cyl)E('cy'+cyl)?.setAttribute('class','cyl fire');st.lastFire=cyl;}
  setStroke(`Firing order ${fo.join('-')}`);}

/* ---------- front (timing & belts) ---------- */
function hull(ps){const p=ps.slice().sort((a,b)=>a.x-b.x||a.y-b.y);if(p.length<3)return p;const cr=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);const lo=[],up=[];
  for(const q of p){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}
  for(const q of p.slice().reverse()){while(up.length>=2&&cr(up[up.length-2],up[up.length-1],q)<=0)up.pop();up.push(q);}
  lo.pop();up.pop();return lo.concat(up);}
function beltPath(cs){const n=cs.length,T=[];if(n<2)return'';
  for(let k=0;k<n;k++){const a=cs[k],b=cs[(k+1)%n],dx=b.x-a.x,dy=b.y-a.y,D=Math.hypot(dx,dy);T.push(Math.atan2(dy,dx)-Math.acos(Math.max(-1,Math.min(1,(a.r-b.r)/D))));}
  let d='';for(let k=0;k<n;k++){const a=cs[k],b=cs[(k+1)%n],ph=T[k],out=T[(k+1)%n];
    if(k===0)d+=`M${f1(a.x+a.r*Math.cos(ph))},${f1(a.y+a.r*Math.sin(ph))}`;
    d+=` L${f1(b.x+b.r*Math.cos(ph))},${f1(b.y+b.r*Math.sin(ph))}`;const del=mod(out-ph,2*Math.PI);
    d+=` A${b.r},${b.r} 0 ${del>Math.PI?1:0},1 ${f1(b.x+b.r*Math.cos(out))},${f1(b.y+b.r*Math.sin(out))}`;}
  return d+'Z';}
function pulleySVG(p){let sp='';const k=p.r>14?3:2;for(let j=0;j<k;j++){const a=j*Math.PI*2/k;sp+=`<line class="spoke" x1="0" y1="0" x2="${f1((p.r-4)*Math.cos(a))}" y2="${f1((p.r-4)*Math.sin(a))}"/>`;}
  return `<g transform="translate(${f1(p.x)},${f1(p.y)})"><circle class="pulley" r="${p.r}"/><g id="r_${p.id}">${sp}</g><circle class="hub" r="3.5"/></g>${p.lab?`<text class="svglab" text-anchor="end" x="${f1(p.x-p.r-5)}" y="${f1(p.y+4)}">${p.lab}</text>`:''}`;}
function frontSVG(s){const banks=bankList(s);let ghost='';const pts=[];
  banks.forEach(b=>{const c=[[-76,-26],[76,-26],[76,-280],[-76,-280]].map(p=>TX(p[0],p[1],b));pts.push(...c);ghost+=`<polygon class="ghost" points="${c.map(p=>f1(p[0])+','+f1(p[1])).join(' ')}"/>`;});
  ghost+=`<path class="ghost" d="M-80,-40 L80,-40 L80,46 L70,104 L-70,104 L-80,46 Z"/>`;pts.push([-82,106],[82,106]);
  const tim=[{id:'tcr',x:0,y:0,r:15,ratio:1,comp:'timing'}];
  banks.forEach((b,i)=>{if(s.vt==='OHV'){if(i===0)tim.push({id:'tcam',x:0,y:-80,r:26,ratio:.5,comp:'timing'});}
    else(s.vt==='SOHC'?[0]:[-34,34]).forEach((lx,k)=>{let[x,y]=TX(lx,-250,b);if(s.layout==='flat')y-=60;tim.push({id:`tc${i}${k}`,x,y,r:s.vt==='SOHC'?30:28,ratio:.5,comp:'timing',lab:i===0&&k===0?'CAM':''});});});
  if(s.vt!=='OHV'){const cams=tim.slice(1),lm=cams.reduce((a,c)=>c.x<a.x?c:a),rm=cams.reduce((a,c)=>c.x>a.x?c:a);
    tim.push({id:'tten',x:lm.x/2-35,y:lm.y/2,r:10,ratio:1.5,comp:'timing'});
    if(s.td==='belt')tim.push({id:'twp',x:rm.x/2+38,y:rm.y/2,r:16,ratio:15/16,comp:'cooling',lab:'W/P'});}
  const acc=[{id:'acr',x:0,y:0,r:34},{id:'aac',x:-125,y:-10,r:22,lab:'A/C'},{id:'aalt',x:-130,y:-62,r:17,lab:'ALT'},{id:'aten',x:110,y:-15,r:11},s.td==='belt'?{id:'aidl',x:60,y:-85,r:12}:{id:'awp',x:60,y:-85,r:19,lab:'W/P',comp:'cooling'}];
  acc.forEach(p=>{p.ratio=34/p.r;p.comp=p.comp||'accessory';});
  st.pulleys=tim.concat(acc);st.pulleys.forEach(p=>pts.push([p.x-p.r-30,p.y-p.r-14],[p.x+p.r,p.y+p.r]));
  const tH=hull(tim),aH=hull(acc);const tcls=s.td==='belt'?'tb-belt':'tb-chain';
  const tPul=tim.filter(p=>p.comp==='timing').map(pulleySVG).join(''),tCool=tim.filter(p=>p.comp==='cooling').map(pulleySVG).join('');
  const aPul=acc.filter(p=>p.comp==='accessory').map(pulleySVG).join(''),aCool=acc.filter(p=>p.comp==='cooling').map(pulleySVG).join('');
  return `<svg viewBox="${bboxView(pts,8)}" xmlns="http://www.w3.org/2000/svg">${DEFS}${ghost}
<g class="comp" data-c="timing">${tPul}<path class="tb-base" d="${beltPath(tH)}"/><path id="tbelt" class="${tcls}" d="${beltPath(tH)}"/></g>${tCool?`<g class="comp" data-c="cooling">${tCool}</g>`:''}
<g class="comp" data-c="accessory">${aPul}</g>${aCool?`<g class="comp" data-c="cooling">${aCool}</g>`:''}<g class="comp" data-c="accessory"><path class="ab-base" d="${beltPath(aH)}"/><path id="abelt" class="ab" d="${beltPath(aH)}"/></g>
<g class="comp" data-c="crank"><circle class="journal" r="8"/></g></svg>`;}
function updFront(th){(st.pulleys||[]).forEach(p=>E('r_'+p.id)?.setAttribute('transform',`rotate(${f1(th*p.ratio)})`));
  const tb=E('tbelt');if(tb)tb.style.strokeDashoffset=f1(-th*.2618);const ab=E('abelt');if(ab)ab.style.strokeDashoffset=f1(-th*.5934);
  setStroke(`Timing ${st.s.td} · cams turn at ½ crank speed`);}

/* ---------- diagram plumbing ---------- */
let lastStroke='';function setStroke(t){if(t!==lastStroke){$('#stroke').textContent=t;lastStroke=t;}}
function renderDiagram(){const s=st.s;if(!s)return;st.fo=firing(s);const special=s.layout==='rotary'||s.layout==='electric';if(special)st.view='section';
  $$('#viewTabs button').forEach(b=>{b.hidden=special&&b.dataset.v!=='section';b.classList.toggle('on',b.dataset.v===st.view);});
  $('#viewTabs button[data-v=section]').textContent=s.layout==='electric'?'Drive unit':'Cross-section';
  st.cache={};st.lastFire=null;lastStroke='';
  $('#svgwrap').innerHTML=st.view==='top'?topSVG(s):st.view==='front'?frontSVG(s):sectionSVG(s);
  st.svg=$('#svgwrap svg');buildChips();applySel();draw();}
function buildChips(){const have=new Set($$('#svgwrap .comp').map(g=>g.dataset.c));const keys=Object.keys(COMPS).filter(k=>have.has(k));
  $('#compChips').innerHTML=keys.map(k=>`<button class="chip" data-c="${k}">${esc(COMPS[k])}</button>`).join('');
  $$('#compChips .chip').forEach(b=>b.onclick=()=>select(st.sel===b.dataset.c?null:b.dataset.c));}
function applySel(){if(st.svg){st.svg.classList.toggle('has-sel',!!st.sel);$$('#svgwrap .comp').forEach(g=>g.classList.toggle('sel',g.dataset.c===st.sel));}
  $$('#compChips .chip').forEach(b=>b.classList.toggle('on',b.dataset.c===st.sel));}
function select(c){st.sel=c;applySel();renderDetail();}
$('#svgwrap').addEventListener('click',ev=>{const g=ev.target.closest('.comp');select(g?(g.dataset.c===st.sel?null:g.dataset.c):null);});
$('#svgwrap').addEventListener('pointermove',ev=>{const g=ev.target.closest('.comp'),tip=$('#tip');if(!g||ev.pointerType==='touch'){tip.classList.remove('on');return;}
  const r=$('#stage').getBoundingClientRect();tip.textContent=COMPS[g.dataset.c]||g.dataset.c;tip.style.left=(ev.clientX-r.left)+'px';tip.style.top=(ev.clientY-r.top)+'px';tip.classList.add('on');});
$('#svgwrap').addEventListener('pointerleave',()=>$('#tip').classList.remove('on'));
$$('#viewTabs button').forEach(b=>b.onclick=()=>{st.view=b.dataset.v;renderDiagram();});
$('#play').onclick=()=>{st.running=!st.running;$('#play').textContent=st.running?'Pause':'Run';};
$('#play').textContent=st.running?'Pause':'Run';
$('#speed').oninput=e=>st.speed=+e.target.value;
function draw(){if(!st.svg||!st.s)return;const s=st.s;if(st.view==='section'){if(s.layout==='rotary')updRotary(st.th);else if(s.layout==='electric')updEV(st.th);else updSection(st.th);}else if(st.view==='top')updTop(st.th);else updFront(st.th);}
function loop(t){const dt=st.last?Math.min(.05,(t-st.last)/1000):0;st.last=t;if(st.running&&!$('#result').hidden)st.th=mod(st.th+dt*(20+st.speed*11),1440);if(!$('#result').hidden)draw();requestAnimationFrame(loop);}
requestAnimationFrame(loop);

