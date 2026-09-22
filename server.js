import express from "express";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM = "https://www.betandplay.com/sportsbook/api/v2";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const POSTS_URL = "https://raw.githubusercontent.com/antoniocarloscrespillo-svg/betandplay-render-bridge/main/posts.json";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const POST_SECRET = process.env.POST_SECRET || "";

const allowedMatchParams = new Set([
  "id","type","urn_id","sort_by","sport_key","sport_id","sport_type","category_id",
  "tournament_id","match_status","bettable","favourite","start_from","start_to",
  "max_per_sport","has_video","page","limit"
]);

const allowedMarketParams = new Set(["group_key", "market_id", "page", "limit"]);
const TOURNAMENT_ALIASES = {
  all: [],
  champions: ["uefa champions league","champions league"],
  europa: ["uefa europa league","europa league"],
  conference: ["uefa conference league","conference league","europa conference league"],
  premier: ["premier league"],
  bundesliga: ["bundesliga"],
  seriea: ["serie a"],
  laliga: ["laliga","la liga","primera division"],
  ligue1: ["ligue 1"],
  nations: ["uefa nations league","nations league"],
  facup: ["fa cup"],
  carabao: ["efl cup","carabao cup","league cup"],
  dfbpokal: ["dfb pokal","dfb-pokal"]
};

function matchesTournament(match, tournamentKey) {
  if (!tournamentKey || tournamentKey === "all") return true;
  const aliases = TOURNAMENT_ALIASES[tournamentKey] || [];
  const name = String(match?.tournament?.name || "").toLowerCase();
  return aliases.some(alias => name.includes(alias));
}


function copyAllowedParams(source, allowed) {
  const out = new URLSearchParams();
  for (const [key, raw] of Object.entries(source)) {
    if (!allowed.has(key)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null || value === "") continue;
      out.append(key, String(value));
    }
  }
  return out;
}

async function fetchUpstream(path, searchParams) {
  const url = new URL(UPSTREAM + path);
  for (const [key, value] of searchParams.entries()) url.searchParams.append(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Referer: "https://www.betandplay.com/",
        Origin: "https://www.betandplay.com"
      },
      signal: controller.signal
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    let body = text;
    if (contentType.includes("application/json")) {
      try { body = JSON.parse(text); } catch {}
    }
    return { ok: response.ok, status: response.status, contentType, body };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHubPosts() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(POSTS_URL + "?t=" + Date.now(), {
      headers: { Accept: "application/json", "User-Agent": "Betandplay-Content-Hub/1.0" },
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) throw new Error("posts_http_" + response.status);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}
function decimalOdd(value) {
  return typeof value === "number" ? (value / 1000).toFixed(value % 10 === 0 ? 2 : 3).replace(/0+$/,"").replace(/\.$/,"") : "";
}

function isGermanMarket(match) {
  const tournament = match?.tournament || {};
  const category = tournament?.category || {};
  const names = [
    tournament?.name,
    tournament?.slug,
    category?.name,
    category?.country_code,
    match?.competitors?.home?.name,
    match?.competitors?.away?.name
  ].filter(Boolean).join(" ").toLowerCase();

  return category?.country_code === "DE" ||
    names.includes("bundesliga") ||
    names.includes("germany") ||
    names.includes("deutschland") ||
    names.includes("dfb");
}

function buildGeneratedPost(match) {
  const home = match?.competitors?.home?.name || "Home";
  const away = match?.competitors?.away?.name || "Away";
  const tournament = match?.tournament?.name || "Football";
  const start = match?.start_time ? new Date(match.start_time) : null;
  const time = start && !Number.isNaN(start.getTime())
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Malta",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(start).replace(",", " ·") + " CEST"
    : "";

  const main = match?.main_market;
  const odds = Array.isArray(main?.outcomes)
    ? main.outcomes.filter(o=>o?.active!==false && typeof o?.odds==="number").slice(0,3).map(o=>({
        label:o.name,
        value:decimalOdd(o.odds)
      }))
    : [];

  const secondary = match?.secondary_market;
  if (secondary?.outcomes?.length) {
    const pick = secondary.outcomes.find(o=>o?.active!==false && typeof o?.odds==="number");
    if (pick) odds.push({ label: pick.name, value: decimalOdd(pick.odds) });
  }

  const oddsLines = odds.map(o=>o.label + " — " + o.value).join("\n");
  const copy =
    "🔥 " + tournament.toUpperCase() + "!\n\n" +
    home + " face " + away + " in one of the standout fixtures on the board. ⚽\n\n" +
    (oddsLines ? "📊 Current Betandplay odds:\n" + oddsLines + "\n\n" : "") +
    (time ? "⏰ Kick-off: " + time + "\n\n" : "") +
    "Pick your angle and enjoy the action! 🔥";

  return {
    id: "generated-" + match.id + "-" + Date.now(),
    created_at: new Date().toISOString(),
    brand: "Betandplay",
    sport: match?.tournament?.sport?.name || "Football",
    competition: tournament,
    time,
    title: home + " vs " + away,
    odds,
    copy,
    generated: true,
    match_id: match.id
  };
}

async function generatePosts({start, end, count=3, excludeGermany=true, tournamentKey="all"}) {
  const params = new URLSearchParams({
    type: "match",
    sport_key: "soccer",
    bettable: "true",
    start_from: start,
    start_to: end,
    limit: "100"
  });

  const result = await fetchUpstream("/matches", params);
  if (!result.ok) {
    const error = new Error("upstream_" + result.status);
    error.status = result.status;
    throw error;
  }

  const matches = Array.isArray(result.body?.data) ? result.body.data : [];
  const candidates = matches
    .filter(m => m?.main_market?.outcomes?.length >= 2)
    .filter(m => matchesTournament(m, tournamentKey))
    .filter(m => !excludeGermany || tournamentKey === "bundesliga" || tournamentKey === "dfbpokal" || !isGermanMarket(m))
    .sort((a,b) => {
      const pa = Number(a?.tournament?.priority || 0);
      const pb = Number(b?.tournament?.priority || 0);
      if (pb !== pa) return pb - pa;
      const ma = Number(a?.available_markets || 0);
      const mb = Number(b?.available_markets || 0);
      if (mb !== ma) return mb - ma;
      return new Date(a?.start_time || 0) - new Date(b?.start_time || 0);
    });

  return candidates.slice(0, Math.max(1, Math.min(6, Number(count)||3))).map(buildGeneratedPost);
}


function normalizeOddsPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload.map(normalizeOddsPayload);

  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "odds" && typeof value === "number") {
      out.raw_odds = value;
      out.odds = value / 1000;
    } else {
      out[key] = normalizeOddsPayload(value);
    }
  }
  return out;
}

function sendUpstream(res, result, normalizeOdds = false) {
  if (!result.ok) {
    return res.status(result.status || 502).json({
      ok: false,
      upstream_status: result.status,
      upstream_content_type: result.contentType,
      message: "Betandplay upstream request failed",
      upstream_body: typeof result.body === "string" ? result.body.slice(0, 1000) : result.body
    });
  }
  return res.json(normalizeOdds ? normalizeOddsPayload(result.body) : result.body);
}

async function telegramApi(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("telegram_bot_token_not_configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const err = new Error(data?.description || `telegram_http_${response.status}`);
      err.status = response.status;
      throw err;
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

function requirePostSecret(req, res, next) {
  if (!POST_SECRET) return res.status(503).json({ ok: false, error: "post_secret_not_configured" });
  if ((req.get("x-bridge-key") || "") !== POST_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

const HUB_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Betandplay Content Hub</title>
<style>
:root{
  --bg:#080a0f;--panel:#11151d;--panel2:#171c26;--text:#f5f7fb;--muted:#96a0b2;
  --accent:#7c5cff;--accent2:#278cff;--line:#242b38;--success:#25c27a;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at top right,#17102f 0,#080a0f 34%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1180px;margin:auto;padding:28px 18px 60px}
header{display:flex;gap:20px;align-items:flex-end;justify-content:space-between;margin-bottom:24px}
.brand h1{margin:0;font-size:30px}.brand p{margin:7px 0 0;color:var(--muted)}
.badge{padding:9px 12px;border:1px solid var(--line);border-radius:999px;background:#0d1118;color:#b8c1d0;font-size:13px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
.stat{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;padding:14px}
.stat b{display:block;font-size:23px;margin-top:4px}.stat span{color:var(--muted);font-size:12px}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
button,.filter,select{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:12px;padding:10px 13px;font-weight:700;cursor:pointer}
.filter.active{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.22);transition:.2s}
.card:hover{transform:translateY(-2px);border-color:#394356}.published{opacity:.5}
.topline{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}
.meta{display:flex;gap:8px;flex-wrap:wrap}.pill{font-size:12px;padding:7px 9px;border-radius:999px;background:#0d121a;border:1px solid var(--line);color:#c5ccda}
.title{font-size:20px;font-weight:800;margin:7px 0 10px}
.odds{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.odd{padding:8px 10px;border-radius:10px;background:#0b0f16;border:1px solid #2a3240;font-size:13px}
.copy{white-space:pre-wrap;background:#0b0f15;border:1px solid var(--line);padding:14px;border-radius:14px;color:#e9edf5;line-height:1.45;font-size:14px;max-height:330px;overflow:auto}
.actions{display:flex;gap:10px;margin-top:14px}.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none}.success{border-color:#285d46;color:#8ce4b8}
.empty{padding:50px 20px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:18px;grid-column:1/-1}
@media(max-width:760px){.grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr 1fr}header{align-items:flex-start;flex-direction:column}.brand h1{font-size:26px}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand"><h1>Betandplay Content Hub</h1><p>Posts, odds and ready-to-publish sportsbook content.</p></div>
  <div class="badge">LIVE CONTENT FEED</div>
</header>

<div class="stats">
  <div class="stat"><span>READY POSTS</span><b id="readyCount">0</b></div>
  <div class="stat"><span>PUBLISHED</span><b id="publishedCount">0</b></div>
  <div class="stat"><span>SPORTS</span><b id="sportCount">0</b></div>
</div>

<div class="toolbar">
  <button class="filter active" data-filter="all">All</button>
  <button class="filter" data-filter="football">Football</button>
  <button class="filter" data-filter="tennis">Tennis</button>
  <button class="filter" data-filter="cricket">Cricket</button>
  <button class="filter" data-filter="other">Other</button>
  <select id="tournamentSelect">
    <option value="all">All tournaments / Best available</option>
    <optgroup label="UEFA">
      <option value="champions">UEFA Champions League</option>
      <option value="europa">UEFA Europa League</option>
      <option value="conference">UEFA Conference League</option>
      <option value="nations">UEFA Nations League</option>
    </optgroup>
    <optgroup label="Top leagues">
      <option value="premier">Premier League</option>
      <option value="bundesliga">Bundesliga</option>
      <option value="seriea">Serie A</option>
      <option value="laliga">LaLiga</option>
      <option value="ligue1">Ligue 1</option>
    </optgroup>
    <optgroup label="Cups">
      <option value="facup">FA Cup</option>
      <option value="carabao">Carabao Cup</option>
      <option value="dfbpokal">DFB-Pokal</option>
    </optgroup>
  </select>
  <select id="contentType">
    <option value="match">Match spotlight</option>
    <option value="tournament">Tournament preview</option>
    <option value="acca">Tournament ACCA</option>
    <option value="picks">Today's picks</option>
    <option value="weekend">Weekend preview</option>
    <option value="surprise">Surprise me</option>
  </select>
  <select id="contentCount">
    <option value="1">1 post</option>
    <option value="3" selected>3 posts</option>
    <option value="5">5 posts</option>
  </select>
  <button id="generateBtn" class="primary">✨ GENERATE CONTENT</button>
  <button id="refreshBtn">↻ Refresh</button>
</div>

<div id="grid" class="grid"></div>
</div>

<script>
function esc(s){
  return String(s??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll(String.fromCharCode(34),"&quot;")
    .replaceAll("'","&#39;");
}
let posts=[];
let current="all";
const published=JSON.parse(localStorage.getItem("bnp_published")||"{}");
let generated=JSON.parse(localStorage.getItem("bnp_generated_posts")||"[]");

function updateStats(){
  const done=posts.filter(p=>published[p.id]).length;
  document.getElementById("readyCount").textContent=posts.length-done;
  document.getElementById("publishedCount").textContent=done;
  document.getElementById("sportCount").textContent=new Set(posts.map(p=>(p.sport||"Other").toLowerCase())).size;
}

function render(){
  const grid=document.getElementById("grid");
  const data=posts.filter(p=>current==="all"||(p.sport||"other").toLowerCase()===current);
  updateStats();

  if(!data.length){
    grid.innerHTML='<div class="empty">No posts in this view yet.</div>';
    return;
  }

  grid.innerHTML=data.map(p=>{
    const done=!!published[p.id];
    const odds=(p.odds||[]).map(o=>'<span class="odd">'+esc(o.label)+' <b>'+esc(o.value)+'</b></span>').join("");
    return '<article class="card '+(done?'published':'')+'" data-id="'+esc(p.id)+'">'+
      '<div class="topline"><div class="meta"><span class="pill">'+esc(p.brand||"Betandplay")+'</span><span class="pill">'+esc(p.sport||"Other")+'</span><span class="pill">'+esc(p.competition||"")+'</span></div><span class="pill">'+esc(p.time||"")+'</span></div>'+
      '<div class="title">'+esc(p.title||"Untitled post")+'</div>'+
      '<div class="odds">'+odds+'</div>'+
      '<div class="copy">'+esc(p.copy||"")+'</div>'+
      '<div class="actions"><button class="primary" data-action="copy" data-id="'+esc(p.id)+'">COPY POST</button><button class="'+(done?'success':'')+'" data-action="publish" data-id="'+esc(p.id)+'">'+(done?'PUBLISHED ✓':'MARK AS PUBLISHED')+'</button></div>'+
    '</article>';
  }).join("");
}

async function loadPosts(){
  const btn=document.getElementById("refreshBtn");
  btn.textContent="Refreshing…";
  try{
    const r=await fetch("/api/content/posts?ts="+Date.now(),{cache:"no-store"});
    const d=await r.json();
    posts=[...generated,...(d.posts||[])];
    render();
  }finally{
    btn.textContent="↻ Refresh";
  }
}

document.addEventListener("click",async e=>{
  const action=e.target?.dataset?.action;
  const id=e.target?.dataset?.id;
  if(!action||!id)return;

  if(action==="copy"){
    const p=posts.find(x=>x.id===id);
    if(!p)return;
    await navigator.clipboard.writeText(p.copy||"");
    const old=e.target.textContent;
    e.target.textContent="COPIED ✓";
    setTimeout(()=>e.target.textContent=old,1200);
  }

  if(action==="publish"){
    published[id]=!published[id];
    localStorage.setItem("bnp_published",JSON.stringify(published));
    render();
  }
});

document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  current=b.dataset.filter;
  render();
});

document.getElementById("refreshBtn").onclick=loadPosts;

document.getElementById("generateBtn").onclick=async()=>{
  const btn=document.getElementById("generateBtn");
  const old=btn.textContent;
  btn.textContent="Generating…";
  btn.disabled=true;

  try{
    const now=new Date();
    const contentType=document.getElementById("contentType").value;
    const longWindow=["tournament","acca","weekend"].includes(contentType);
    const end=new Date(now.getTime()+(longWindow?7:1)*24*60*60*1000);
    const r=await fetch("/api/content/generate",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        start:now.toISOString(),
        end:end.toISOString(),
        count:Number(document.getElementById("contentCount").value||3),
        contentType,
        tournamentKey:document.getElementById("tournamentSelect").value,
        excludeGermany:true
      })
    });
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||"generation_failed");

    generated=[...(d.posts||[]),...generated].slice(0,30);
    localStorage.setItem("bnp_generated_posts",JSON.stringify(generated));
    posts=[...generated,...posts.filter(p=>!p.generated)];
    current="all";
    document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));
    document.querySelector('.filter[data-filter="all"]').classList.add("active");
    render();
  }catch(e){
    alert("Could not generate posts: "+e.message);
  }finally{
    btn.textContent=old;
    btn.disabled=false;
  }
};

loadPosts();
setInterval(loadPosts,60000);
</script>
</body>
</html>`;

app.get("/", (_req, res) => res.type("html").send(HUB_HTML));

app.get("/api/content/posts", async (_req, res) => {
  try {
    const posts = (await fetchHubPosts()).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
    res.set("Cache-Control","no-store");
    res.json({ ok:true, posts, source:"github-live-feed" });
  } catch (error) {
    res.status(502).json({ ok:false, posts:[], error:String(error?.message||error) });
  }
});

app.post("/api/content/generate", async (req, res) => {
  const start = typeof req.body?.start === "string" ? req.body.start : new Date().toISOString();
  const end = typeof req.body?.end === "string"
    ? req.body.end
    : new Date(Date.now()+24*60*60*1000).toISOString();
  const count = Number(req.body?.count || 3);
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : "match";
  const tournamentKey = typeof req.body?.tournamentKey === "string" ? req.body.tournamentKey : "all";
  const excludeGermany = req.body?.excludeGermany !== false;

  try {
    const sourcePosts = await generatePosts({start,end,count:Math.max(count,8),excludeGermany,tournamentKey});
    let posts = sourcePosts.slice(0,count);

    if (contentType === "tournament" || contentType === "weekend") {
      const byCompetition = new Map();
      for (const p of sourcePosts) {
        if (!byCompetition.has(p.competition)) byCompetition.set(p.competition,[]);
        byCompetition.get(p.competition).push(p);
      }
      posts = [...byCompetition.entries()].slice(0,count).map(([competition,items],index)=>({
        ...items[0],
        id:"generated-"+contentType+"-"+index+"-"+Date.now(),
        title:competition + (contentType === "weekend" ? " — Weekend Preview" : " — Tournament Preview"),
        odds:items.flatMap(x=>x.odds.slice(0,1)).slice(0,4),
        copy:"🔥 "+competition.toUpperCase()+(contentType === "weekend" ? " — WEEKEND PREVIEW" : " IS COMING!")+"\n\n"+
          items.slice(0,4).map(x=>"⚽ "+x.title+(x.time ? " · "+x.time : "")).join("\n")+
          "\n\nBig fixtures are coming up. Check the latest Betandplay markets and build your picks! 🔥",
        content_type:contentType
      }));
    }

    if (contentType === "acca") {
      const byCompetition = new Map();
      for (const p of sourcePosts) {
        if (!byCompetition.has(p.competition)) byCompetition.set(p.competition,[]);
        byCompetition.get(p.competition).push(p);
      }
      const groups = [...byCompetition.entries()].filter(([,items])=>items.length>=2);
      const selected = groups.length ? groups : [["Today's Football",sourcePosts]];
      posts = selected.slice(0,count).map(([competition,items],index)=>{
        const legs = items.slice(0,4).map(x=>({title:x.title,pick:x.odds[0]})).filter(x=>x.pick?.value);
        const combined = legs.reduce((total,x)=>total*Number(x.pick.value||1),1);
        return {
          ...items[0],
          id:"generated-acca-"+index+"-"+Date.now(),
          title:competition+" ACCA",
          odds:legs.map(x=>({label:x.title+" · "+x.pick.label,value:x.pick.value})),
          copy:"🔥 "+competition.toUpperCase()+" ACCA\n\n"+
            legs.map(x=>"⚽ "+x.title+" — "+x.pick.label+" @ "+x.pick.value).join("\n")+
            (legs.length>1 ? "\n\n🎯 Combined odds: "+combined.toFixed(2) : "")+
            "\n\nWho's backing it? 🔥",
          content_type:"acca"
        };
      });
    }

    if (contentType === "picks") {
      posts = sourcePosts.slice(0,count).map((p,index)=>({
        ...p,
        id:"generated-picks-"+index+"-"+Date.now(),
        title:"Today's Pick — "+p.title,
        copy:"🎯 TODAY'S PICK\n\n"+p.title+"\n"+
          (p.odds[0] ? "⚽ "+p.odds[0].label+" @ "+p.odds[0].value+"\n\n" : "")+
          "One to watch on today's Betandplay board. 🔥",
        content_type:"picks"
      }));
    }

    if (contentType === "surprise") {
      posts = sourcePosts.slice(0,count).map((p,index)=>({
        ...p,
        id:"generated-surprise-"+index+"-"+Date.now(),
        content_type:index % 2 === 0 ? "match" : "picks"
      }));
    }

    res.json({ok:true,posts,content_type:contentType,tournament:tournamentKey,exclude_germany:excludeGermany});
  } catch (error) {
    res.status(error?.status || 502).json({
      ok:false,
      error:String(error?.message || error)
    });
  }
});

app.get("/health", async (_req, res) => {
  try {
    const params = new URLSearchParams({ limit: "1" });
    const [result,posts] = await Promise.all([
      fetchUpstream("/matches", params),
      fetchHubPosts().catch(()=>[])
    ]);
    res.status(result.ok ? 200 : 503).json({
      ok: result.ok,
      service: "betandplay-content-hub",
      upstream_status: result.status,
      telegram_configured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && POST_SECRET),
      content_posts: posts.length,
      live_content_feed: true,
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ ok:false, error:error?.name==="AbortError"?"upstream_timeout":"upstream_error" });
  }
});

app.get("/matches", async (req, res) => {
  try {
    const params = copyAllowedParams(req.query, allowedMatchParams);
    return sendUpstream(res, await fetchUpstream("/matches", params), false);
  } catch (error) {
    return res.status(502).json({ ok:false, error:error?.name==="AbortError"?"upstream_timeout":"upstream_error" });
  }
});

app.get("/matches/:id/markets", async (req, res) => {
  const id = String(req.params.id || "");
  if (!/^\d+$/.test(id)) return res.status(400).json({ ok:false, error:"invalid_match_id" });

  try {
    const params = copyAllowedParams(req.query, allowedMarketParams);
    return sendUpstream(res, await fetchUpstream("/matches/" + id + "/markets", params), true);
  } catch (error) {
    return res.status(502).json({ ok:false, error:error?.name==="AbortError"?"upstream_timeout":"upstream_error" });
  }
});

app.get("/telegram/status", (_req, res) => {
  res.json({
    ok:true,
    bot_token_configured:Boolean(TELEGRAM_BOT_TOKEN),
    chat_id_configured:Boolean(TELEGRAM_CHAT_ID),
    post_secret_configured:Boolean(POST_SECRET)
  });
});

app.post("/telegram/send", requirePostSecret, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const chatId = req.body?.chat_id || TELEGRAM_CHAT_ID;
  if (!text) return res.status(400).json({ ok:false, error:"text_required" });
  if (!chatId) return res.status(503).json({ ok:false, error:"telegram_chat_id_not_configured" });

  try {
    const result = await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
    return res.json({ ok:true, message_id:result.message_id, sent_at:new Date().toISOString() });
  } catch (error) {
    return res.status(error?.status || 502).json({ ok:false, error:"telegram_send_failed", message:String(error?.message||error) });
  }
});

app.use((_req,res)=>res.status(404).json({ok:false,error:"not_found"}));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Betandplay Content Hub listening on port ${PORT}`);
});
