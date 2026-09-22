import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM = process.env.SPORTSBOOK_API_BASE || "https://www.betandplay.com/sportsbook/api/v2";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 120000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cache = new Map();

const TOURNAMENT_ALIASES = {
  all: [],
  champions: ["uefa champions league", "champions league"],
  europa: ["uefa europa league", "europa league"],
  conference: ["uefa conference league", "conference league", "europa conference league"],
  premier: ["premier league"],
  bundesliga: ["bundesliga"],
  seriea: ["serie a"],
  laliga: ["laliga", "la liga", "primera division"],
  ligue1: ["ligue 1"],
  nations: ["uefa nations league", "nations league"],
  facup: ["fa cup"],
  carabao: ["efl cup", "carabao cup", "league cup"],
  dfbpokal: ["dfb pokal", "dfb-pokal"]
};

function cached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(key, value) {
  cache.set(key, { createdAt: Date.now(), value });
}

function decimalOdd(value) {
  if (typeof value !== "number") return "";
  return (value / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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

function isWomensEvent(match) {
  const tournament = match?.tournament || {};
  const category = tournament?.category || {};
  const competitors = Array.isArray(match?.competitors) ? match.competitors : [];
  const text = [
    match?.name, match?.slug, match?.gender, match?.type,
    tournament?.name, tournament?.slug, tournament?.gender,
    category?.name, category?.slug, category?.gender,
    category?.country_code,
    match?.competitors?.home?.name, match?.competitors?.away?.name,
    ...competitors.flatMap(c => [c?.name, c?.slug, c?.gender])
  ].filter(Boolean).join(" ").toLowerCase();

  const femaleMarkers = [
    "women", "woman", "women's", "womens", "female", "ladies",
    "frauen", "damen", "femenino", "femenina", "femenil",
    "femminile", "feminine", "féminin", "feminin",
    "kvinner", "kvinne", "naiset", "dam", "damer",
    "wsl", "uwcl"
  ];

  return femaleMarkers.some(marker => text.includes(marker));
}

function matchesTournament(match, tournamentKey) {
  if (!tournamentKey || tournamentKey === "all") return true;
  const aliases = TOURNAMENT_ALIASES[tournamentKey] || [];
  const name = String(match?.tournament?.name || "").toLowerCase();
  return aliases.some(alias => name.includes(alias));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en",
        "User-Agent": "Mozilla/5.0 Chrome/126 Safari/537.36",
        Referer: "https://www.betandplay.com/",
        Origin: "https://www.betandplay.com"
      },
      signal: controller.signal
    });

    const text = await response.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}

    if (!response.ok) {
      const error = new Error("upstream_" + response.status);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function getMatches({ start, end, tournamentKey = "all", excludeGermany = true }) {
  const key = JSON.stringify({ start, end, tournamentKey, excludeGermany });
  const hit = cached(key);
  if (hit) return hit;

  const url = new URL(UPSTREAM + "/matches");
  url.searchParams.set("type", "match");
  url.searchParams.set("sport_key", "soccer");
  url.searchParams.set("bettable", "true");
  url.searchParams.set("start_from", start);
  url.searchParams.set("start_to", end);
  url.searchParams.set("limit", "100");

  const body = await fetchJson(url);
  const matches = Array.isArray(body?.data) ? body.data : [];

  const filtered = matches
    .filter(m => !isWomensEvent(m))
    .filter(m => m?.main_market?.outcomes?.length >= 2)
    .filter(m => matchesTournament(m, tournamentKey))
    .filter(m => !excludeGermany || tournamentKey === "bundesliga" || tournamentKey === "dfbpokal" || !isGermanMarket(m))
    .sort((a, b) => {
      const pa = Number(a?.tournament?.priority || 0);
      const pb = Number(b?.tournament?.priority || 0);
      if (pb !== pa) return pb - pa;
      const ma = Number(a?.available_markets || 0);
      const mb = Number(b?.available_markets || 0);
      if (mb !== ma) return mb - ma;
      return new Date(a?.start_time || 0) - new Date(b?.start_time || 0);
    });

  setCached(key, filtered);
  return filtered;
}

function toPost(match) {
  const home = match?.competitors?.home?.name || "Home";
  const away = match?.competitors?.away?.name || "Away";
  const competition = match?.tournament?.name || "Football";
  const time = match?.start_time
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Malta",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date(match.start_time)).replace(",", " ·") + " CEST"
    : "";

  const odds = (match?.main_market?.outcomes || [])
    .filter(o => o?.active !== false && typeof o?.odds === "number")
    .slice(0, 3)
    .map(o => ({ label: o.name, value: decimalOdd(o.odds) }));

  const secondary = (match?.secondary_market?.outcomes || [])
    .find(o => o?.active !== false && typeof o?.odds === "number");

  if (secondary) {
    odds.push({ label: secondary.name, value: decimalOdd(secondary.odds) });
  }

  return {
    id: String(match.id),
    title: home + " vs " + away,
    competition,
    time,
    odds
  };
}

function headlineFor(type, competition) {
  const comp = String(competition || "Football").toUpperCase();
  if (type === "weekend") return "🔥 A HUGE WEEKEND OF " + comp + "!";
  if (type === "tournament") return "🏆 " + comp + " IS BACK!";
  if (type === "acca") return "🔥 " + comp + " ACCA";
  if (type === "picks") return "🎯 TODAY'S VALUE";
  return "🔥 " + comp + " — MATCHDAY!";
}

function formatOdds(odds, limit=4) {
  return (odds || []).slice(0, limit).map(o => "📊 " + o.label + " — **" + o.value + "**").join("\n");
}

function makeContent(type, posts, count) {
  const selected = posts.slice(0, Math.max(1, count));

  if (type === "match") {
    return selected.map(p => ({
      ...p,
      contentType: "Match Spotlight",
      copy:
        headlineFor(type, p.competition) + "\n\n" +
        "**" + p.title + "** takes centre stage and we've got the latest prices ready. ⚽️🔥\n\n" +
        (p.odds.length ? "👀 **Latest odds:**\n" + formatOdds(p.odds, 4) + "\n\n" : "") +
        (p.time ? "⏰ **Kick-off:** " + p.time + "\n\n" : "") +
        "Pick your side, check the markets and enjoy the action! 🎯\n\n" +
        "👉 **CHECK THE ODDS ON BETANDPLAY**"
    }));
  }

  if (type === "picks") {
    return selected.map((p,index) => {
      const pick = p.odds[index % Math.max(1,p.odds.length)] || p.odds[0];
      return {
        ...p,
        contentType: "Today's Pick",
        copy:
          headlineFor(type, p.competition) + "\n\n" +
          "One game worth keeping an eye on today: **" + p.title + "**. 👀\n\n" +
          (pick ? "⚽️ **Our angle:** " + pick.label + " @ **" + pick.value + "**\n\n" : "") +
          (p.time ? "⏰ " + p.time + "\n\n" : "") +
          "Would you add it to your betslip? 🔥\n\n" +
          "👉 **CHECK THE MARKET**"
      };
    });
  }

  const grouped = new Map();
  for (const p of posts) {
    if (!grouped.has(p.competition)) grouped.set(p.competition, []);
    grouped.get(p.competition).push(p);
  }

  if (type === "tournament" || type === "weekend") {
    return [...grouped.entries()].slice(0, count).map(([competition, items]) => {
      const fixtures = items.slice(0, 5);
      return {
        id: type + "-" + competition,
        title: competition + (type === "weekend" ? " — Weekend Preview" : " — Tournament Preview"),
        competition,
        contentType: type === "weekend" ? "Weekend Preview" : "Tournament Preview",
        odds: fixtures.flatMap(x => x.odds.slice(0, 1)).slice(0, 5),
        time: fixtures[0]?.time || "",
        copy:
          headlineFor(type, competition) + "\n\n" +
          (type === "weekend"
            ? "The weekend is loaded with football and these are some of the games on our radar. ⚽️🔥\n\n"
            : "Big fixtures are coming up and there is plenty to choose from. Here are some of the games on our radar. 👀\n\n") +
          fixtures.map(x => "⚽️ **" + x.title + "**" + (x.odds[0] ? " — " + x.odds[0].label + " @ **" + x.odds[0].value + "**" : "")).join("\n") +
          "\n\nBuild your picks, find your value and enjoy the action! 🎯\n\n" +
          "👉 **CHECK ALL MARKETS ON BETANDPLAY**"
      };
    });
  }

  if (type === "acca") {
    const groups = [...grouped.entries()].filter(([, items]) => items.length >= 2);
    return groups.slice(0, count).map(([competition, items]) => {
      const legs = items.slice(0, 4)
        .map((x,i) => ({ title: x.title, pick: x.odds[i % Math.max(1,x.odds.length)] || x.odds[0] }))
        .filter(x => x.pick?.value);
      const combined = legs.reduce((total, x) => total * Number(x.pick.value || 1), 1);

      return {
        id: "acca-" + competition,
        title: competition + " ACCA",
        competition,
        contentType: "Tournament ACCA",
        odds: legs.map(x => ({ label: x.title + " · " + x.pick.label, value: x.pick.value })),
        time: items[0]?.time || "",
        copy:
          headlineFor(type, competition) + "\n\n" +
          "Looking for an acca? We've put together a few selections from **" + competition + "**. 👀\n\n" +
          legs.map(x => "⚽️ **" + x.title + "**\n↳ " + x.pick.label + " @ **" + x.pick.value + "**").join("\n\n") +
          (legs.length > 1 ? "\n\n🎯 **Combined odds: " + combined.toFixed(2) + "**" : "") +
          "\n\nWould you play it as it is or change a leg? 🔥\n\n" +
          "👉 **BUILD YOUR ACCA**"
      };
    });
  }

  return makeContent("match", posts, count);
}

function stripWomensEvents(matches) {
  return (matches || []).filter(match => !isWomensEvent(match));
}

function competitionKey(name="") {
  const n = name.toLowerCase();
  if (n.includes("champions league")) return "champions";
  if (n.includes("europa league")) return "europa";
  if (n.includes("conference league")) return "conference";
  if (n.includes("premier league")) return "premier";
  if (n.includes("bundesliga")) return "bundesliga";
  if (n.includes("serie a")) return "seriea";
  if (n.includes("la liga") || n.includes("laliga") || n.includes("primera division")) return "laliga";
  if (n.includes("ligue 1")) return "ligue1";
  if (n.includes("fa cup")) return "facup";
  if (n.includes("nations league")) return "nations";
  return "other";
}

function buildSportsReport(matches, period="daily", days=1) {
  const grouped = new Map();
  for (const match of stripWomensEvents(matches)) {
    const p = toPost(match);
    const key = competitionKey(p.competition);
    if (!grouped.has(key)) grouped.set(key, { key, competition: p.competition, items: [] });
    grouped.get(key).items.push(p);
  }

  const priority = ["champions","europa","conference","premier","bundesliga","seriea","laliga","ligue1","facup","nations","other"];
  const sections = [...grouped.values()]
    .sort((a,b)=>priority.indexOf(a.key)-priority.indexOf(b.key))
    .map(section => ({
      ...section,
      items: section.items.slice(0,6).map(item => ({
        ...item,
        featuredOdds: item.odds.slice(0,3)
      }))
    }));

  const highlights = sections
    .flatMap(s => s.items.map(i => ({...i, competition:s.competition, key:s.key})))
    .slice(0,3);

  return {
    generatedAt: new Date().toISOString(),
    dateLabel: new Intl.DateTimeFormat("en-GB", {
      timeZone:"Europe/Malta",
      weekday:"long",
      day:"2-digit",
      month:"long"
    }).format(new Date()),
    period,
    days,
    title: period === "monthly" ? "Monthly Sports Outlook" : period === "weekly" ? "Weekly Sports Outlook" : "Daily Sports Highlights",
    intro: period === "monthly"
      ? "A visual overview of the most relevant football events and competitions across the next 30 days, based on Betandplay data."
      : period === "weekly"
        ? "A visual overview of the most relevant football action across the next 7 days, based on Betandplay data."
        : "A quick visual overview of the most relevant football action and current Betandplay prices.",
    sections,
    highlights
  };
}

async function getReportMatches(days) {
  const start = new Date();
  const chunks = [];
  let cursor = new Date(start);

  while (cursor < new Date(start.getTime() + days * 24 * 60 * 60 * 1000)) {
    const chunkEnd = new Date(Math.min(
      cursor.getTime() + 7 * 24 * 60 * 60 * 1000,
      start.getTime() + days * 24 * 60 * 60 * 1000
    ));

    const batch = await getMatches({
      start: cursor.toISOString(),
      end: chunkEnd.toISOString(),
      tournamentKey: "all",
      excludeGermany: false
    });

    chunks.push(...batch);
    cursor = new Date(chunkEnd.getTime() + 1000);
  }

  const deduped = new Map();
  for (const match of chunks) deduped.set(String(match.id), match);

  return [...deduped.values()].sort((a,b)=>{
    const pa = Number(a?.tournament?.priority || 0);
    const pb = Number(b?.tournament?.priority || 0);
    if (pb !== pa) return pb - pa;
    return new Date(a?.start_time || 0) - new Date(b?.start_time || 0);
  });
}

app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "1h"
}));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "betandplay-content-hub-v2",
    mode: "on-demand",
    cache_ttl_ms: CACHE_TTL_MS
  });
});

app.get("/api/report", async (req, res) => {
  const period = ["daily","weekly","monthly"].includes(String(req.query.period))
    ? String(req.query.period)
    : "daily";
  const days = period === "monthly" ? 30 : period === "weekly" ? 7 : 1;

  try {
    const matches = await getReportMatches(days);
    const maxMatches = period === "monthly" ? 180 : period === "weekly" ? 120 : 60;
    const report = buildSportsReport(matches.slice(0,maxMatches), period, days);

    report.dateLabel = period === "daily"
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone:"Europe/Malta",
          weekday:"long",
          day:"2-digit",
          month:"long"
        }).format(new Date())
      : period === "weekly"
        ? "Next 7 days"
        : "Next 30 days";

    res.set("Cache-Control","no-store");
    res.json({ok:true, report});
  } catch (error) {
    res.status(error?.status || 502).json({ok:false,error:String(error?.message || error)});
  }
});

app.get("/api/daily-report", async (_req, res) => {
  try {
    const matches = await getReportMatches(1);
    const report = buildSportsReport(matches.slice(0,60), "daily", 1);
    res.set("Cache-Control","no-store");
    res.json({ok:true, report});
  } catch (error) {
    res.status(error?.status || 502).json({ok:false,error:String(error?.message || error)});
  }
});

app.post("/api/generate", async (req, res) => {
  const type = typeof req.body?.contentType === "string" ? req.body.contentType : "match";
  const tournamentKey = typeof req.body?.tournamentKey === "string" ? req.body.tournamentKey : "all";
  const count = Math.min(5, Math.max(1, Number(req.body?.count || 3)));
  const excludeGermany = req.body?.excludeGermany !== false;

  const start = new Date();
  const days = ["tournament", "acca", "weekend"].includes(type) ? 7 : 1;
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  try {
    const matches = await getMatches({
      start: start.toISOString(),
      end: end.toISOString(),
      tournamentKey,
      excludeGermany
    });

    const base = stripWomensEvents(matches).slice(0, 24).map(toPost);
    const posts = makeContent(type, base, count);

    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      posts,
      meta: {
        tournamentKey,
        contentType: type,
        count: posts.length,
        sourceMatches: base.length,
        windowDays: days
      }
    });
  } catch (error) {
    res.status(error?.status || 502).json({
      ok: false,
      error: String(error?.message || error)
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Betandplay Content Hub V2 listening on port " + PORT);
});
