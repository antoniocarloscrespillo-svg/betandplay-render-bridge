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

function makeContent(type, posts, count) {
  const selected = posts.slice(0, Math.max(1, count));

  if (type === "match") {
    return selected.map(p => ({
      ...p,
      contentType: "Match Spotlight",
      copy:
        "🔥 " + p.competition.toUpperCase() + "!\n\n" +
        p.title + " takes centre stage. ⚽\n\n" +
        (p.odds.length ? "📊 Current Betandplay odds:\n" + p.odds.map(o => o.label + " — " + o.value).join("\n") + "\n\n" : "") +
        (p.time ? "⏰ Kick-off: " + p.time + "\n\n" : "") +
        "What's your pick? 👀🔥"
    }));
  }

  if (type === "picks") {
    return selected.map(p => ({
      ...p,
      contentType: "Today's Pick",
      copy:
        "🎯 TODAY'S PICK\n\n" +
        p.title + "\n" +
        (p.odds[0] ? "⚽ " + p.odds[0].label + " @ " + p.odds[0].value + "\n\n" : "") +
        "One to watch on today's Betandplay board. 🔥"
    }));
  }

  const grouped = new Map();
  for (const p of posts) {
    if (!grouped.has(p.competition)) grouped.set(p.competition, []);
    grouped.get(p.competition).push(p);
  }

  if (type === "tournament" || type === "weekend") {
    return [...grouped.entries()].slice(0, count).map(([competition, items]) => ({
      id: type + "-" + competition,
      title: competition + (type === "weekend" ? " — Weekend Preview" : " — Tournament Preview"),
      competition,
      contentType: type === "weekend" ? "Weekend Preview" : "Tournament Preview",
      odds: items.flatMap(x => x.odds.slice(0, 1)).slice(0, 4),
      time: items[0]?.time || "",
      copy:
        "🔥 " + competition.toUpperCase() + (type === "weekend" ? " — WEEKEND PREVIEW" : " IS COMING!") + "\n\n" +
        items.slice(0, 4).map(x => "⚽ " + x.title + (x.time ? " · " + x.time : "")).join("\n") +
        "\n\nBig fixtures are coming up. Check the latest Betandplay markets and build your picks! 🔥"
    }));
  }

  if (type === "acca") {
    const groups = [...grouped.entries()].filter(([, items]) => items.length >= 2);
    return groups.slice(0, count).map(([competition, items]) => {
      const legs = items.slice(0, 4)
        .map(x => ({ title: x.title, pick: x.odds[0] }))
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
          "🔥 " + competition.toUpperCase() + " ACCA\n\n" +
          legs.map(x => "⚽ " + x.title + " — " + x.pick.label + " @ " + x.pick.value).join("\n") +
          (legs.length > 1 ? "\n\n🎯 Combined odds: " + combined.toFixed(2) : "") +
          "\n\nWho's backing it? 🔥"
      };
    });
  }

  return makeContent("match", posts, count);
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

    const base = matches.slice(0, 24).map(toPost);
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
