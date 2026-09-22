import express from "express";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM = "https://www.betandplay.com/sportsbook/api/v2";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const POST_SECRET = process.env.POST_SECRET || "";
const CONTENT_HUB_DATA = process.env.CONTENT_HUB_DATA || "[]";

const allowedMatchParams = new Set([
  "id","type","urn_id","sort_by","sport_key","sport_id","sport_type","category_id",
  "tournament_id","match_status","bettable","favourite","start_from","start_to",
  "max_per_sport","has_video","page","limit"
]);

const allowedMarketParams = new Set(["group_key", "market_id", "page", "limit"]);

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

function parseHubPosts() {
  try {
    const parsed = JSON.parse(CONTENT_HUB_DATA);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  --bg:#090b10;--panel:#11151d;--panel2:#171c26;--text:#f5f7fb;--muted:#96a0b2;
  --accent:#7c5cff;--accent2:#278cff;--line:#242b38;--success:#25c27a;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at top right,#17102f 0,#090b10 34%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1180px;margin:auto;padding:28px 18px 60px}
header{display:flex;gap:20px;align-items:flex-end;justify-content:space-between;margin-bottom:26px}
.brand h1{margin:0;font-size:30px}.brand p{margin:7px 0 0;color:var(--muted)}
.badge{padding:9px 12px;border:1px solid var(--line);border-radius:999px;background:#0d1118;color:#b8c1d0;font-size:13px}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
button,.filter{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:12px;padding:10px 13px;font-weight:700;cursor:pointer}
.filter.active{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.22)}
.topline{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}
.meta{display:flex;gap:8px;flex-wrap:wrap}.pill{font-size:12px;padding:7px 9px;border-radius:999px;background:#0d121a;border:1px solid var(--line);color:#c5ccda}
.title{font-size:20px;font-weight:800;margin:7px 0 10px}
.odds{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.odd{padding:8px 10px;border-radius:10px;background:#0b0f16;border:1px solid #2a3240;font-size:13px}
.copy{white-space:pre-wrap;background:#0b0f15;border:1px solid var(--line);padding:14px;border-radius:14px;color:#e9edf5;line-height:1.45;font-size:14px}
.actions{display:flex;gap:10px;margin-top:14px}.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none}.published{opacity:.55}
.empty{padding:50px 20px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:18px}
@media(max-width:760px){.grid{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}.brand h1{font-size:26px}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand"><h1>Betandplay Content Hub</h1><p>Posts, odds and ready-to-publish sportsbook content.</p></div>
  <div class="badge">LIVE FEED</div>
</header>
<div class="toolbar">
  <button class="filter active" data-filter="all">All</button>
  <button class="filter" data-filter="football">Football</button>
  <button class="filter" data-filter="tennis">Tennis</button>
  <button class="filter" data-filter="cricket">Cricket</button>
  <button class="filter" data-filter="other">Other</button>
</div>
<div id="grid" class="grid"></div>
</div>
<script>
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
let posts=[];
let current="all";
const published=JSON.parse(localStorage.getItem("bnp_published")||"{}");

function render(){
  const grid=document.getElementById("grid");
  const data=posts.filter(p=>current==="all"||(p.sport||"other").toLowerCase()===current);
  if(!data.length){grid.innerHTML='<div class="empty">No posts in this view yet.</div>';return;}
  grid.innerHTML=data.map(p=>{
    const done=!!published[p.id];
    const odds=(p.odds||[]).map(o=>'<span class="odd">'+esc(o.label)+' <b>'+esc(o.value)+'</b></span>').join("");
    return '<article class="card '+(done?'published':'')+'" data-id="'+esc(p.id)+'">'+
      '<div class="topline"><div class="meta"><span class="pill">'+esc(p.brand||"Betandplay")+'</span><span class="pill">'+esc(p.sport||"Other")+'</span><span class="pill">'+esc(p.competition||"")+'</span></div><span class="pill">'+esc(p.time||"")+'</span></div>'+
      '<div class="title">'+esc(p.title||"Untitled post")+'</div>'+
      '<div class="odds">'+odds+'</div>'+
      '<div class="copy">'+esc(p.copy||"")+'</div>'+
      '<div class="actions"><button class="primary" onclick="copyPost(\''+esc(p.id)+'\')">COPY POST</button><button onclick="markPublished(\''+esc(p.id)+'\')">'+(done?'PUBLISHED ✓':'MARK AS PUBLISHED')+'</button></div>'+
    '</article>';
  }).join("");
}
async function copyPost(id){
  const p=posts.find(x=>x.id===id); if(!p)return;
  await navigator.clipboard.writeText(p.copy||"");
}
function markPublished(id){
  published[id]=!published[id];
  localStorage.setItem("bnp_published",JSON.stringify(published));
  render();
}
document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));
  b.classList.add("active"); current=b.dataset.filter; render();
});
fetch("/api/content/posts").then(r=>r.json()).then(d=>{posts=d.posts||[];render();}).catch(()=>render());
</script>
</body>
</html>`;

app.get("/", (_req, res) => res.type("html").send(HUB_HTML));

app.get("/api/content/posts", (_req, res) => {
  const posts = parseHubPosts().sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
  res.json({ ok:true, posts });
});

app.get("/health", async (_req, res) => {
  try {
    const params = new URLSearchParams({ limit: "1" });
    const result = await fetchUpstream("/matches", params);
    res.status(result.ok ? 200 : 503).json({
      ok: result.ok,
      service: "betandplay-content-hub",
      upstream_status: result.status,
      telegram_configured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && POST_SECRET),
      content_posts: parseHubPosts().length,
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
