const http=require("http");
const PORT=process.env.PORT||3000;

const CARDS={
  ucl:{name:"UEFA Champions League",short:"UCL",a:"#06285d",b:"#2563eb",accent:"#79b7ff"},
  bundesliga:{name:"Bundesliga",short:"BUNDESLIGA",a:"#5a0000",b:"#e00018",accent:"#ff6b73"},
  premier:{name:"Premier League",short:"PREMIER",a:"#22002e",b:"#6b1689",accent:"#d185ff"},
  laliga:{name:"LaLiga",short:"LALIGA",a:"#2b0910",b:"#d71920",accent:"#ff7a7e"},
  seriea:{name:"Serie A",short:"SERIE A",a:"#05214f",b:"#0077d9",accent:"#61c1ff"},
  ligue1:{name:"Ligue 1",short:"LIGUE 1",a:"#071f32",b:"#12a9c8",accent:"#75ecff"},
  europa:{name:"UEFA Europa League",short:"EUROPA",a:"#402000",b:"#e26b00",accent:"#ffb457"},
  conference:{name:"UEFA Conference League",short:"CONFERENCE",a:"#073a2c",b:"#18a66a",accent:"#6ff0b2"},
  facup:{name:"FA Cup",short:"FA CUP",a:"#251038",b:"#7a3db4",accent:"#c693ff"},
  coppa_italia:{name:"Coppa Italia",short:"COPPA ITALIA",a:"#003723",b:"#008c52",accent:"#64e2a7"},
  dfbpokal:{name:"DFB-Pokal",short:"DFB-POKAL",a:"#1c1c1c",b:"#bb2029",accent:"#ff737a"},
  carabao:{name:"Carabao Cup",short:"CARABAO",a:"#003323",b:"#00a56e",accent:"#6ff0bd"}
};

function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function cardSvg(key){
  const c=CARDS[key]; if(!c)return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient>
      <radialGradient id="glow" cx=".78" cy=".22" r=".55"><stop offset="0" stop-color="${c.accent}" stop-opacity=".48"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></radialGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="16"/></filter>
    </defs>
    <rect width="720" height="360" rx="28" fill="url(#bg)"/>
    <rect width="720" height="360" rx="28" fill="url(#glow)"/>
    <g opacity=".12" stroke="${c.accent}" fill="none">
      <circle cx="590" cy="90" r="140" stroke-width="2"/><circle cx="590" cy="90" r="100" stroke-width="2"/>
      <path d="M0 285 C170 230 270 330 460 260 S650 210 760 240" stroke-width="3"/>
    </g>
    <g transform="translate(42 42)">
      <rect width="68" height="68" rx="18" fill="white" fill-opacity=".12" stroke="white" stroke-opacity=".22"/>
      <path d="M18 43 L34 18 L50 43 Z" fill="${c.accent}"/>
      <circle cx="34" cy="34" r="5" fill="white"/>
    </g>
    <text x="42" y="164" fill="white" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" letter-spacing="2">CONTENT HUB</text>
    <text x="42" y="218" fill="white" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="800">${esc(c.short)}</text>
    <text x="42" y="258" fill="${c.accent}" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="700">${esc(c.name)}</text>
    <g transform="translate(520 155)" fill="none" stroke="white" stroke-opacity=".22">
      <circle cx="70" cy="70" r="64" stroke-width="2"/><circle cx="70" cy="70" r="38" stroke-width="2"/>
      <path d="M70 4 L86 47 L132 48 L95 75 L108 120 L70 94 L32 120 L45 75 L8 48 L54 47 Z" stroke-width="3"/>
    </g>
  </svg>`;
}

function galleryHtml(){
 const items=Object.entries(CARDS).map(([key,c])=>`<a class="card" href="/competitions/${key}.svg"><img src="/competitions/${key}.svg" alt="${esc(c.name)}"><span>${esc(c.name)}</span></a>`).join("");
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Content Hub Assets</title><style>
 body{margin:0;background:#071827;color:#fff;font-family:Arial,sans-serif}.wrap{max-width:1400px;margin:auto;padding:32px}.head{margin-bottom:24px}.head h1{margin:0 0 5px}.head p{margin:0;color:#8fa9c0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{display:block;text-decoration:none;color:#fff;background:#0d243a;border:1px solid #1e3b56;border-radius:16px;overflow:hidden}.card img{display:block;width:100%;aspect-ratio:2/1;object-fit:cover}.card span{display:block;padding:12px 14px;font-weight:700;font-size:13px}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.grid{grid-template-columns:1fr}}</style></head><body><div class="wrap"><div class="head"><h1>Content Hub Assets</h1><p>Internal competition artwork host</p></div><div class="grid">${items}</div></div></body></html>`;
}

const server=http.createServer((req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(url.pathname==="/health"){
   res.writeHead(200,{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*"});
   return res.end(JSON.stringify({ok:true,service:"content-hub-assets",competitions:Object.keys(CARDS)}));
 }
 if(url.pathname==="/"){
   res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*"});
   return res.end(galleryHtml());
 }
 if(url.pathname==="/manifest.json"){
   const manifest={competitions:Object.fromEntries(Object.entries(CARDS).map(([k,v])=>[k,{name:v.name,url:"/competitions/"+k+".svg"}]))};
   res.writeHead(200,{"content-type":"application/json","access-control-allow-origin":"*","cache-control":"public,max-age=300"});
   return res.end(JSON.stringify(manifest));
 }
 const match=url.pathname.match(/^\/competitions\/([a-z0-9_]+)\.svg$/);
 if(match){
   const svg=cardSvg(match[1]);
   if(!svg){res.writeHead(404,{"access-control-allow-origin":"*"});return res.end("Not found");}
   res.writeHead(200,{"content-type":"image/svg+xml; charset=utf-8","access-control-allow-origin":"*","cache-control":"public,max-age=86400"});
   return res.end(svg);
 }
 res.writeHead(404,{"access-control-allow-origin":"*"});res.end("Not found");
});
server.listen(PORT,"0.0.0.0",()=>console.log("Content Hub Asset Host listening on "+PORT));
