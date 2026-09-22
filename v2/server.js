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

const BIG_ENTITIES = {
  soccer: [
    "real madrid","barcelona","atletico madrid","liverpool","arsenal","manchester city",
    "manchester united","chelsea","tottenham","bayern munich","bayern münchen","borussia dortmund",
    "inter milan","internazionale","ac milan","juventus","paris saint-germain","psg"
  ],
  tennis: [
    "carlos alcaraz","jannik sinner","novak djokovic","alexander zverev","daniil medvedev"
  ],
  basketball: [
    "los angeles lakers","boston celtics","golden state warriors","new york knicks",
    "milwaukee bucks","denver nuggets","dallas mavericks","phoenix suns"
  ]
};

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

function isBigEntityMatch(match, sportKey) {
  const names = BIG_ENTITIES[sportKey] || [];
  const haystack = [
    match?.name,
    match?.competitors?.home?.name,
    match?.competitors?.away?.name,
    ...(Array.isArray(match?.competitors) ? match.competitors.map(c=>c?.name) : [])
  ].filter(Boolean).join(" ").toLowerCase();

  return names.some(name => haystack.includes(name));
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

async function getMatches({ start, end, tournamentKey = "all", excludeGermany = true, sportKey = "soccer" }) {
  const key = JSON.stringify({ start, end, tournamentKey, excludeGermany, sportKey });
  const hit = cached(key);
  if (hit) return hit;

  const url = new URL(UPSTREAM + "/matches");
  url.searchParams.set("type", "match");
  url.searchParams.set("sport_key", sportKey);
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

function collectMarketObjects(node, out=[]) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectMarketObjects(item,out);
    return out;
  }

  const outcomes = Array.isArray(node.outcomes) ? node.outcomes : null;
  const marketName = node.name || node.market_name || node.label || node.key;
  if (outcomes && marketName) out.push(node);

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectMarketObjects(value,out);
  }
  return out;
}

function marketOutcomeToOdd(outcome) {
  if (!outcome || outcome?.active === false) return null;
  const raw = typeof outcome.odds === "number" ? outcome.odds
    : typeof outcome.price === "number" ? outcome.price
    : typeof outcome.value === "number" ? outcome.value
    : null;
  if (raw === null) return null;
  const value = raw > 100 ? decimalOdd(raw) : String(raw);
  const label = outcome.name || outcome.label || outcome.selection_name || outcome.key || "Selection";
  return {label,value};
}

function marketFamily(name="") {
  const n = String(name).toLowerCase();

  if (/early payout|match result|1x2|moneyline|winner/.test(n)) return "result";
  if (/double chance/.test(n)) return "double_chance";
  if (/both teams to score|btts/.test(n)) return "btts";
  if (/total goals|over\/under|total.*goals|goals over|goals under/.test(n)) return "goals_total";
  if (/draw no bet/.test(n)) return "draw_no_bet";
  if (/asian handicap|handicap/.test(n)) return "handicap";
  if (/team total|home.*total|away.*total/.test(n)) return "team_total";
  if (/corners|corner/.test(n)) return "corners";
  if (/cards|booking|bookings/.test(n)) return "cards";
  if (/both teams.*corner/.test(n)) return "corners";
  if (/to qualify|qualification/.test(n)) return "qualify";
  if (/first goal|first team to score|team to score first/.test(n)) return "first_goal";
  if (/half.?time.*result|1st half.*result/.test(n)) return "half_time";
  if (/second half.*result|2nd half.*result/.test(n)) return "second_half";
  if (/clean sheet/.test(n)) return "clean_sheet";
  if (/correct score/.test(n)) return "correct_score";
  if (/player.*shot|shots on target|player.*score|anytime scorer|goalscorer/.test(n)) return "player_prop";
  return "other";
}

function chooseSelectionFromMarket(market, family) {
  const selections = (market.outcomes || [])
    .map(marketOutcomeToOdd)
    .filter(Boolean)
    .filter(o => {
      const odd = Number(o.value);
      return Number.isFinite(odd) && odd >= 1.15 && odd <= 8;
    });

  if (!selections.length) return null;

  if (family === "goals_total" || family === "team_total" || family === "corners" || family === "cards") {
    const over = selections.find(o => /^over\b/i.test(o.label));
    if (over) return over;
  }

  if (family === "btts") {
    return selections.find(o => /^yes$/i.test(o.label)) || selections[0];
  }

  if (family === "double_chance" || family === "draw_no_bet" || family === "handicap") {
    return selections.sort((a,b)=>Math.abs(Number(a.value)-1.75)-Math.abs(Number(b.value)-1.75))[0];
  }

  return selections.sort((a,b)=>Math.abs(Number(a.value)-2)-Math.abs(Number(b.value)-2))[0];
}

function chooseBettingOptions(markets) {
  const familyOrder = [
    "goals_total",
    "btts",
    "double_chance",
    "draw_no_bet",
    "handicap",
    "team_total",
    "corners",
    "cards",
    "qualify",
    "first_goal",
    "half_time",
    "clean_sheet",
    "player_prop",
    "correct_score"
  ];

  const buckets = new Map();

  for (const market of markets) {
    const marketName = String(market.name || market.market_name || market.label || market.key || "").trim();
    if (!marketName) continue;

    const family = marketFamily(marketName);
    if (family === "result" || family === "other") continue;

    if (!buckets.has(family)) buckets.set(family, []);
    buckets.get(family).push({market, marketName});
  }

  const options = [];
  const usedLabels = new Set();

  for (const family of familyOrder) {
    const candidates = buckets.get(family) || [];
    let chosen = null;

    for (const candidate of candidates) {
      const selection = chooseSelectionFromMarket(candidate.market, family);
      if (!selection) continue;

      const key = family + "|" + selection.label.toLowerCase();
      if (usedLabels.has(key)) continue;

      chosen = {
        market: candidate.marketName,
        label: selection.label,
        value: selection.value,
        family
      };
      break;
    }

    if (chosen) {
      usedLabels.add(family + "|" + chosen.label.toLowerCase());
      options.push(chosen);
    }

    if (options.length >= 7) break;
  }

  return options;
}

async function fetchMatchMarkets(matchId) {
  const url = new URL(UPSTREAM + "/matches/" + encodeURIComponent(matchId) + "/markets");
  url.searchParams.set("limit","200");
  const body = await fetchJson(url);
  return collectMarketObjects(body,[]);
}

function toBigEvent(match) {
  const post = toPost(match);
  const category = match?.tournament?.category || {};
  return {
    ...post,
    country: category?.country_code || category?.name || "",
    tournamentId: match?.tournament?.id || null,
    teamNames: [
      match?.competitors?.home?.name,
      match?.competitors?.away?.name,
      ...(Array.isArray(match?.competitors) ? match.competitors.map(c=>c?.name) : [])
    ].filter(Boolean)
  };
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
    sport: match?.tournament?.sport?.name || match?.sport?.name || "Sport",
    sportKey: match?.tournament?.sport?.key || match?.sport?.key || "",
    startTime: match?.start_time || null,
    time,
    odds,
    bettingOptions: []
  };
}

function buildVariantPost(p, style="short") {
  const options = Array.isArray(p.bettingOptions) ? p.bettingOptions : [];
  const main = (p.odds || []).slice(0,3);
  const extra = options.slice(0,6);
  const mainLines = main.map(o=>"• "+o.label+" — "+o.value).join("\n");
  const extraLines = extra.map(o=>"• "+o.market+": "+o.label+" @ "+o.value).join("\n");

  if (style === "short") {
    return (
      "🔥 "+p.title+"\n\n"+
      (p.time ? "⏰ "+p.time+"\n" : "")+
      "🏆 "+p.competition+"\n\n"+
      (mainLines ? "MAIN ODDS\n"+mainLines+"\n\n" : "")+
      (extra[0] ? "One extra angle: "+extra[0].market+" — "+extra[0].label+" @ "+extra[0].value+"\n\n" : "")+
      "👉 CHECK THE MATCH ON BETANDPLAY"
    );
  }

  if (style === "aggressive") {
    const recommended = extra.slice(0,3);
    return (
      "🔥 BIG GAME. BIG MARKETS.\n\n"+
      p.title+" is one of the games to attack on the board today. If you're building a betslip, here are the angles we'd be looking at. 👀\n\n"+
      (p.time ? "⏰ "+p.time+"\n" : "")+
      "🏆 "+p.competition+"\n\n"+
      (mainLines ? "MAIN ODDS\n"+mainLines+"\n\n" : "")+
      (recommended.length ? "BET IDEAS\n"+recommended.map((o,i)=>(i+1)+". "+o.market+": "+o.label+" @ "+o.value).join("\n")+"\n\n" : "")+
      "🔥 Our approach: don't just look at the 1X2 — check the goals and alternative markets before kick-off.\n\n"+
      "👉 BUILD YOUR BETSLIP ON BETANDPLAY"
    );
  }

  return (
    "🏆 MATCH PREVIEW: "+p.title+"\n\n"+
    p.title+" is one of the standout fixtures coming up in "+p.competition+". Rather than looking only at the match result, the current Betandplay board gives us a few different ways to approach it.\n\n"+
    (p.time ? "⏰ Kick-off: "+p.time+"\n\n" : "")+
    (mainLines ? "MAIN ODDS\n"+mainLines+"\n\n" : "")+
    (extraLines ? "MARKETS TO WATCH\n"+extraLines+"\n\n" : "")+
    "The straight result gives the basic shape of the market, but goals, BTTS, handicaps and other alternatives can offer a very different angle depending on how you expect the game to develop.\n\n"+
    "If you prefer a simpler bet, stick to the main market. If you're expecting a more open game, the goal-related markets are worth checking before the price moves. 👀\n\n"+
    "👉 CHECK THE FULL MATCH MARKET ON BETANDPLAY"
  );
}

function buildRichMatchCopy(p, variant=0) {
  const options = Array.isArray(p.bettingOptions) ? p.bettingOptions : [];
  const main = (p.odds || []).slice(0,3);
  const extra = options.slice(0,6);

  const openings = [
    "Tonight's one to watch: " + p.title + ". " + p.competition + " action with a few markets worth checking before kick-off. ⚽️",
    p.title + " is on the board today — and this one has more to look at than just picking a winner. 👀",
    "Game on: " + p.title + ". If you're building tonight's betslip, here are a few prices currently available on Betandplay. 🔥",
    "Keeping an eye on " + p.title + " today? We've pulled out the main prices plus a few alternative markets. 🎯"
  ];

  const closes = [
    "Straight result or goals market — what's going on your betslip? 👀",
    "Plenty of angles here. Which market catches your eye?",
    "Keep it simple or go looking for a different angle? 🔥",
    "Have a pick for this one? Check the full market before kick-off."
  ];

  const mainLines = main.map(o=>"• "+o.label+" — "+o.value).join("\n");
  const extraLines = extra.map(o=>"• "+o.market+": "+o.label+" @ "+o.value).join("\n");

  return (
    openings[variant % openings.length] + "\n\n" +
    (p.time ? "⏰ " + p.time + "\n" : "") +
    "🏆 " + p.competition + "\n\n" +
    (mainLines ? "MAIN ODDS\n" + mainLines + "\n\n" : "") +
    (extraLines ? "OTHER MARKETS\n" + extraLines + "\n\n" : "") +
    closes[variant % closes.length] + "\n\n" +
    "👉 CHECK ALL MARKETS ON BETANDPLAY"
  );
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
      copy: buildRichMatchCopy(p, selected.indexOf(p))
    }));
  }

  if (type === "picks") {
    return selected.map((p,index) => {
      const pick = p.odds[index % Math.max(1,p.odds.length)] || p.odds[0];
      const alternatives=(p.bettingOptions||[]).slice(0,4);
      const intros=[
        "One for the shortlist today: "+p.title+".",
        "A market we're checking today: "+p.title+".",
        p.title+" makes today's watchlist.",
        "Looking for a game to add to the betslip? "+p.title+" is worth a look."
      ];
      const endings=[
        "Would you take this price or look elsewhere in the market?",
        "One to play, or one to leave alone? 👀",
        "What's your angle on this one?",
        "Check the full board before making your call. 🎯"
      ];
      return {
        ...p,
        contentType:"Today's Pick",
        copy:
          "🎯 TODAY'S PICK\n\n"+
          intros[index%intros.length]+" 👀\n\n"+
          (pick ? "Our pick: "+pick.label+" @ "+pick.value+"\n\n" : "")+
          (alternatives.length ? "Also on the board:\n"+alternatives.map(o=>"• "+o.market+": "+o.label+" @ "+o.value).join("\n")+"\n\n" : "")+
          (p.time ? "⏰ "+p.time+"\n\n" : "")+
          endings[index%endings.length]+"\n\n"+
          "👉 CHECK THE MARKET ON BETANDPLAY"
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

function normalizeSearchText(value="") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .trim();
}

function matchSearchHaystack(match) {
  return [
    match?.name,
    match?.slug,
    match?.competitors?.home?.name,
    match?.competitors?.away?.name,
    match?.tournament?.name,
    match?.tournament?.category?.name
  ].filter(Boolean).map(normalizeSearchText).join(" ");
}

function stripWomensEvents(matches) {
  return (matches || []).filter(match => !isWomensEvent(match));
}

function competitionKey(name="") {
  const n = name.toLowerCase();
  if (n.includes("australian open")) return "australianopen";
  if (n.includes("roland garros") || n.includes("french open")) return "rolandgarros";
  if (n.includes("wimbledon")) return "wimbledon";
  if (n.includes("us open")) return "usopen";
  if (n.includes("champions league")) return "champions";
  if (n.includes("europa league")) return "europa";
  if (n.includes("conference league")) return "conference";
  if (n.includes("premier league")) return "premier";
  if (n.includes("bundesliga")) return "bundesliga";
  if (n.includes("serie a")) return "seriea";
  if (n.includes("la liga") || n.includes("laliga") || n.includes("primera division")) return "laliga";
  if (n.includes("ligue 1")) return "ligue1";
  if (n.includes("coppa italia")) return "coppa_italia";
  if (n.includes("copa del rey")) return "copa_del_rey";
  if (n.includes("fa cup")) return "facup";
  if (n.includes("efl cup") || n.includes("carabao cup") || n.includes("league cup")) return "carabao";
  if (n.includes("dfb pokal") || n.includes("dfb-pokal")) return "dfbpokal";
  if (n.includes("nations league")) return "nations";
  return "other";
}

function buildSportsReport(matches, period="daily", days=1) {
  const cleanMatches = stripWomensEvents(matches);
  const grouped = new Map();

  for (const match of cleanMatches) {
    const p = toPost(match);
    const key = competitionKey(p.competition);
    if (!grouped.has(key)) grouped.set(key, { key, competition: p.competition, items: [] });
    grouped.get(key).items.push(p);
  }

  const priority = ["champions","australianopen","rolandgarros","wimbledon","usopen","europa","conference","premier","bundesliga","seriea","laliga","ligue1","facup","carabao","copa_del_rey","coppa_italia","dfbpokal","nations","other"];
  const perCompetition = period === "monthly" ? 14 : period === "weekly" ? 9 : 6;

  const sections = [...grouped.values()]
    .sort((a,b)=>{
      const ai=priority.indexOf(a.key); const bi=priority.indexOf(b.key);
      return (ai===-1?999:ai)-(bi===-1?999:bi);
    })
    .map(section => ({
      ...section,
      items: section.items
        .sort((a,b)=>new Date(a.startTime||0)-new Date(b.startTime||0))
        .slice(0,perCompetition)
        .map(item => ({...item, featuredOdds:item.odds.slice(0,3)}))
    }))
    .filter(section=>section.items.length);

  const allItems = sections.flatMap(s => s.items.map(i => ({...i, competition:s.competition, key:s.key})));
  const highlights = allItems.slice(0,5);

  const dayMap = new Map();
  for (const item of allItems) {
    if (!item.startTime) continue;
    const dateKey = new Intl.DateTimeFormat("en-CA", {
      timeZone:"Europe/Malta", year:"numeric", month:"2-digit", day:"2-digit"
    }).format(new Date(item.startTime));
    const label = new Intl.DateTimeFormat("en-GB", {
      timeZone:"Europe/Malta", weekday:"short", day:"2-digit", month:"short"
    }).format(new Date(item.startTime));
    if (!dayMap.has(dateKey)) dayMap.set(dateKey,{dateKey,label,items:[]});
    dayMap.get(dateKey).items.push(item);
  }

  const calendarDays = [...dayMap.values()]
    .sort((a,b)=>a.dateKey.localeCompare(b.dateKey))
    .map(d=>({...d,items:d.items.slice(0,8)}));

  const weekMap = new Map();
  if (period === "monthly") {
    for (const day of calendarDays) {
      const dt = new Date(day.dateKey+"T12:00:00Z");
      const monday = new Date(dt);
      const dow = (monday.getUTCDay()+6)%7;
      monday.setUTCDate(monday.getUTCDate()-dow);
      const weekKey = monday.toISOString().slice(0,10);
      if (!weekMap.has(weekKey)) weekMap.set(weekKey,{weekKey,days:[],events:0});
      const w=weekMap.get(weekKey);
      w.days.push(day);
      w.events += day.items.length;
    }
  }

  const calendarWeeks = [...weekMap.values()].map((w,index)=>({
    ...w,
    label:"Week "+(index+1),
    range:w.days.length ? w.days[0].label+" – "+w.days[w.days.length-1].label : ""
  }));

  const sports = [...new Set(allItems.map(i=>i.sport).filter(Boolean))];

  return {
    generatedAt:new Date().toISOString(),
    dateLabel:new Intl.DateTimeFormat("en-GB", {
      timeZone:"Europe/Malta", weekday:"long", day:"2-digit", month:"long"
    }).format(new Date()),
    period,
    days,
    title:period==="monthly" ? "Monthly Sports Outlook" : period==="weekly" ? "Weekly Sports Outlook" : "Daily Sports Highlights",
    intro:period==="monthly"
      ? "A 30-day planning view of the strongest football and tennis events currently available in the Betandplay API, organised by competition and date."
      : period==="weekly"
        ? "A 7-day planning view of the strongest football and tennis events currently available in the Betandplay API."
        : "A quick visual overview of the strongest football and tennis action currently available in the Betandplay API.",
    sections,
    highlights,
    calendarDays,
    calendarWeeks,
    totalEvents:allItems.length,
    competitionCount:sections.length,
    sportCount:sports.length,
    sports
  };
}

async function getReportMatches(days) {
  const start = new Date();
  const endLimit = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  const chunks = [];
  const sports = ["soccer","tennis"];
  const chunkDays = days >= 30 ? 3 : days >= 7 ? 2 : 1;

  for (const sportKey of sports) {
    let cursor = new Date(start);

    while (cursor < endLimit) {
      const chunkEnd = new Date(Math.min(
        cursor.getTime() + chunkDays * 24 * 60 * 60 * 1000,
        endLimit.getTime()
      ));

      const batch = await getMatches({
        start:cursor.toISOString(),
        end:chunkEnd.toISOString(),
        tournamentKey:"all",
        excludeGermany:false,
        sportKey
      });

      chunks.push(...batch);
      cursor = new Date(chunkEnd.getTime() + 1000);
    }
  }

  const deduped = new Map();
  for (const match of stripWomensEvents(chunks)) deduped.set(String(match.id), match);

  return [...deduped.values()].sort((a,b)=>{
    const ak=competitionKey(a?.tournament?.name||"");
    const bk=competitionKey(b?.tournament?.name||"");
    const priority=["champions","australianopen","rolandgarros","wimbledon","usopen","europa","conference","premier","bundesliga","seriea","laliga","ligue1","facup","carabao","copa_del_rey","coppa_italia","dfbpokal","nations","other"];
    const ai=priority.indexOf(ak), bi=priority.indexOf(bk);
    if (ai !== bi) return (ai===-1?999:ai)-(bi===-1?999:bi);
    return new Date(a?.start_time||0)-new Date(b?.start_time||0);
  });
}

async function getBigEvents(days=30) {
  const start = new Date();
  const endLimit = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  const sports = ["soccer","tennis","basketball"];
  const chunks = [];

  for (const sportKey of sports) {
    let cursor = new Date(start);
    while (cursor < endLimit) {
      const chunkEnd = new Date(Math.min(cursor.getTime()+5*24*60*60*1000,endLimit.getTime()));
      const batch = await getMatches({
        start:cursor.toISOString(),
        end:chunkEnd.toISOString(),
        tournamentKey:"all",
        excludeGermany:false,
        sportKey
      });
      chunks.push(...batch.filter(m=>isBigEntityMatch(m,sportKey)));
      cursor = new Date(chunkEnd.getTime()+1000);
    }
  }

  const deduped = new Map();
  for (const match of stripWomensEvents(chunks)) deduped.set(String(match.id),match);

  return [...deduped.values()]
    .sort((a,b)=>new Date(a?.start_time||0)-new Date(b?.start_time||0))
    .map(toBigEvent);
}

function findBigEventById(events, matchId) {
  return (events || []).find(e=>String(e.id)===String(matchId));
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

app.get("/api/big-events", async (_req, res) => {
  try {
    const events = await getBigEvents(30);
    res.set("Cache-Control","no-store");
    res.json({ok:true,events});
  } catch (error) {
    res.status(error?.status || 502).json({ok:false,error:String(error?.message || error)});
  }
});

app.get("/api/match-markets/:id", async (req,res) => {
  try {
    const markets = await fetchMatchMarkets(req.params.id);
    const options = chooseBettingOptions(markets);
    res.json({ok:true,options});
  } catch (error) {
    res.status(error?.status || 502).json({ok:false,error:String(error?.message || error)});
  }
});

app.post("/api/generate-variants", async (req,res) => {
  const matchId=String(req.body?.matchId || "");
  if(!matchId) return res.status(400).json({ok:false,error:"match_id_required"});

  try {
    const events=await getBigEvents(30);
    const event=findBigEventById(events,matchId);
    if(!event) return res.status(404).json({ok:false,error:"match_not_found"});

    try {
      const markets=await fetchMatchMarkets(matchId);
      event.bettingOptions=chooseBettingOptions(markets);
    } catch {}

    const variants=[
      {
        ...event,
        contentType:"Short Post",
        variant:1,
        style:"short",
        copy:buildVariantPost(event,"short")
      },
      {
        ...event,
        contentType:"Aggressive Picks",
        variant:2,
        style:"aggressive",
        copy:buildVariantPost(event,"aggressive")
      },
      {
        ...event,
        contentType:"Context Preview",
        variant:3,
        style:"long",
        copy:buildVariantPost(event,"long")
      }
    ];

    res.json({ok:true,variants});
  } catch (error) {
    res.status(error?.status || 502).json({ok:false,error:String(error?.message || error)});
  }
});

app.get("/api/report", async (req, res) => {
  const period = ["daily","weekly","monthly"].includes(String(req.query.period))
    ? String(req.query.period)
    : "daily";
  const days = period === "monthly" ? 30 : period === "weekly" ? 7 : 1;

  try {
    const matches = await getReportMatches(days);
    const maxMatches = period === "monthly" ? 320 : period === "weekly" ? 180 : 80;
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

app.get("/api/search-matches", async (req, res) => {
  const q = normalizeSearchText(req.query.q || "");
  if (q.length < 2) return res.json({ok:true,matches:[]});

  const start = new Date();
  const end = new Date(start.getTime() + 45 * 24 * 60 * 60 * 1000);

  try {
    const sports = ["soccer","tennis"];
    const batches = await Promise.all(sports.map(sportKey =>
      getMatches({
        start:start.toISOString(),
        end:end.toISOString(),
        tournamentKey:"all",
        excludeGermany:false,
        sportKey
      })
    ));

    const matches = stripWomensEvents(batches.flat())
      .filter(m => matchSearchHaystack(m).includes(q))
      .sort((a,b)=>new Date(a?.start_time||0)-new Date(b?.start_time||0))
      .slice(0,20)
      .map(toPost);

    res.set("Cache-Control","no-store");
    res.json({ok:true,matches});
  } catch (error) {
    res.status(error?.status || 502).json({ok:false,error:String(error?.message || error)});
  }
});

app.post("/api/generate-from-match", async (req, res) => {
  const matchId = String(req.body?.matchId || "");
  if (!matchId) return res.status(400).json({ok:false,error:"match_id_required"});

  const start = new Date();
  const end = new Date(start.getTime() + 45 * 24 * 60 * 60 * 1000);

  try {
    const sports = ["soccer","tennis"];
    const batches = await Promise.all(sports.map(sportKey =>
      getMatches({
        start:start.toISOString(),
        end:end.toISOString(),
        tournamentKey:"all",
        excludeGermany:false,
        sportKey
      })
    ));

    const match = stripWomensEvents(batches.flat()).find(m => String(m.id) === matchId);
    if (!match) return res.status(404).json({ok:false,error:"match_not_found"});

    const basePost = toPost(match);
    try {
      const markets = await fetchMatchMarkets(match.id);
      basePost.bettingOptions = chooseBettingOptions(markets);
    } catch {}
    const post = makeContent("match",[basePost],1)[0];
    res.json({ok:true,post});
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

    if (type === "match" || type === "picks") {
      const enrichCount = Math.min(count, 5);
      await Promise.all(base.slice(0,enrichCount).map(async p => {
        try {
          const markets = await fetchMatchMarkets(p.id);
          p.bettingOptions = chooseBettingOptions(markets);
        } catch {}
      }));
    }

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
