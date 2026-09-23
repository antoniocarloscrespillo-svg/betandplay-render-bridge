const http=require("http");
const fs=require("fs");
const path=require("path");
const root=path.join(__dirname,"public");

const competitions={
 champions:["UEFA Champions League","Football","#123B73","#2459B8","★"],
 premier:["Premier League","Football","#261038","#5A1D73","♛"],
 bundesliga:["Bundesliga","Football","#B30818","#E3202D","B"],
 bundesliga2:["2. Bundesliga","Football","#17395D","#2C6AA0","2B"],
 seriea:["Serie A","Football","#0A3F88","#12A7D8","A"],
 laliga:["LaLiga","Football","#101820","#F15A24","L"],
 europa:["UEFA Europa League","Football","#111111","#F47B20","E"],
 conference:["UEFA Conference League","Football","#123D2A","#45B649","C"],
 ligue1:["Ligue 1","Football","#0C1A31","#D4FF00","1"],
 facup:["FA Cup","Football","#2D145B","#7356D8","FA"],
 carabao:["Carabao Cup","Football","#0A3A2B","#26B36A","LC"],
 dfbpokal:["DFB-Pokal","Football","#123B2B","#7ABF45","DFB"],
 coppa_italia:["Coppa Italia","Football","#103B6D","#37A6D8","CI"],
 copa_del_rey:["Copa del Rey","Football","#5E1224","#D4A73C","CR"],
 eredivisie:["Eredivisie","Football","#111111","#E5001D","E"],
 primeira_liga:["Primeira Liga","Football","#0E4030","#24A16A","PL"],
 saudi_pro:["Saudi Pro League","Football","#143C2B","#62B46C","SPL"],
 nations:["UEFA Nations League","Football","#202D5B","#D6427A","NL"],
 world_cup:["World Cup","Football","#5D1637","#C59D5F","WC"],
 world_cup_qual:["World Cup Qualifiers","Football","#30445A","#7790A8","WQ"],
 euro:["UEFA Euro","Football","#163A70","#F2C94C","EURO"],
 euro_qual:["Euro Qualifiers","Football","#274C77","#7FB3D5","EQ"],
 nhl:["NHL","Ice Hockey","#111111","#6D7B87","NHL"],
 nba:["NBA","Basketball","#123B73","#E64545","NBA"],
 nfl:["NFL","American Football","#123B73","#C42032","NFL"],
 afl:["AFL","Australian Rules","#123B73","#DA2C38","AFL"],
 nrl:["NRL","Rugby League","#0A2F24","#1D9B63","NRL"],
 ipl:["IPL","Cricket","#26266F","#E8458B","IPL"],
 cricket_intl:["International Cricket","Cricket","#114B3A","#E0B341","CR"],
 six_nations:["Six Nations","Rugby Union","#243B6B","#6B8FD6","6N"],
 rugby_world_cup:["Rugby World Cup","Rugby Union","#1C4A38","#B6CF4A","RWC"],
 formula1:["Formula 1","Motorsport","#151515","#E10600","F1"],
 australianopen:["Australian Open","Tennis","#115A90","#2BA8D8","AO"],
 rolandgarros:["Roland Garros","Tennis","#824020","#D9822B","RG"],
 wimbledon:["Wimbledon","Tennis","#214C35","#6B2E83","W"],
 usopen:["US Open","Tennis","#123B73","#F4C542","US"],
 masters1000:["ATP Masters 1000","Tennis","#123B73","#41A3D9","1000"]
};

function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function cardSvg(key){
 const d=competitions[key]||[key.replace(/_/g," "),"Sport","#153B5A","#2583D8",key.slice(0,3).toUpperCase()];
 const [label,sport,c1,c2,mark]=d;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="650" viewBox="0 0 1200 650">
 <defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
  <radialGradient id="r"><stop stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
 </defs>
 <rect width="1200" height="650" rx="34" fill="url(#g)"/>
 <circle cx="1010" cy="90" r="260" fill="url(#r)"/>
 <circle cx="160" cy="560" r="240" fill="url(#r)"/>
 <path d="M0 505 C240 425 435 590 665 485 S1010 405 1200 485 V650 H0Z" fill="#061523" opacity=".27"/>
 <g opacity=".13" fill="none" stroke="#fff" stroke-width="5">
  <circle cx="930" cy="370" r="150"/><circle cx="930" cy="370" r="88"/><path d="M780 370h300M930 220v300"/>
 </g>
 <rect x="64" y="58" width="165" height="42" rx="21" fill="#fff" opacity=".13"/>
 <text x="147" y="86" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#fff">${esc(sport).toUpperCase()}</text>
 <text x="68" y="325" font-family="Arial,Helvetica,sans-serif" font-size="132" font-weight="900" fill="#fff">${esc(mark)}</text>
 <text x="68" y="410" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="800" fill="#fff">${esc(label)}</text>
 <text x="70" y="454" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="600" fill="#fff" opacity=".72">CONTENT HUB · NEXT COMPETITION</text>
 </svg>`;
}
function gallery(){
 const cards=Object.entries(competitions).map(([k,v])=>`<a href="/competitions/${k}.svg"><img src="/competitions/${k}.svg"><span>${esc(v[0])}</span></a>`).join("");
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Content Hub Assets</title><style>body{margin:0;background:#08192a;color:#fff;font-family:Arial;padding:26px}h1{margin:0 0 22px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px}a{color:#fff;text-decoration:none;background:#10253a;padding:10px;border-radius:14px}img{width:100%;aspect-ratio:12/6.5;object-fit:cover;border-radius:10px;display:block}span{display:block;padding:10px 4px 3px;font-weight:700}</style></head><body><h1>Content Hub Asset Host</h1><div class="grid">${cards}</div></body></html>`;
}
http.createServer((req,res)=>{
 const raw=decodeURIComponent((req.url||"/").split("?")[0]);
 if(raw==="/"){
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache"});return res.end(gallery());
 }
 const m=raw.match(/^\/competitions\/([a-z0-9_]+)\.svg$/);
 if(m){
  const svg=cardSvg(m[1]);
  res.writeHead(200,{"Content-Type":"image/svg+xml; charset=utf-8","Cache-Control":"public, max-age=86400","Access-Control-Allow-Origin":"*"});
  return res.end(svg);
 }
 const file=path.join(root,raw.replace(/^\/+/, ""));
 if(!file.startsWith(root)){res.writeHead(403);return res.end("Forbidden")}
 fs.readFile(file,(err,data)=>{
  if(err){res.writeHead(404,{"Access-Control-Allow-Origin":"*"});return res.end("Not found")}
  res.writeHead(200,{"Content-Type":"application/octet-stream","Cache-Control":"public, max-age=86400","Access-Control-Allow-Origin":"*"});res.end(data);
 });
}).listen(process.env.PORT||3000,"0.0.0.0",()=>console.log("Content Hub Asset Host ready"));
