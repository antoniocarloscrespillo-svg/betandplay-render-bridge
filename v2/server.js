import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM = process.env.SPORTSBOOK_API_BASE || "https://www.betandplay.com/sportsbook/api/v2";
const UPSTREAM_V3 = process.env.SPORTSBOOK_API_BASE_V3 || UPSTREAM.replace(/\/v2\/?$/,"/v3");
const SPORTSBOOK_ORIGIN = (()=>{ try { return new URL(UPSTREAM).origin; } catch { return "https://www.betandplay.com"; } })();
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 120000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cache = new Map();
const wikiImageCache = new Map();
const logoBinaryCache = new Map();
const BIG_EVENTS_ENRICHED_TTL_MS = 10 * 60 * 1000;

const TEAM_VISUAL_ALIASES = {
  "real madrid":"Real Madrid CF",
  "barcelona":"FC Barcelona",
  "fc barcelona":"FC Barcelona",
  "atletico madrid":"Atlético Madrid",
  "atlético madrid":"Atlético Madrid",
  "liverpool":"Liverpool FC",
  "arsenal":"Arsenal FC",
  "manchester city":"Manchester City FC",
  "manchester united":"Manchester United FC",
  "chelsea":"Chelsea FC",
  "tottenham":"Tottenham Hotspur FC",
  "tottenham hotspur":"Tottenham Hotspur FC",
  "bayern munich":"FC Bayern Munich",
  "bayern münchen":"FC Bayern Munich",
  "borussia dortmund":"Borussia Dortmund",
  "bayer leverkusen":"Bayer 04 Leverkusen",
  "bayer 04 leverkusen":"Bayer 04 Leverkusen",
  "rb leipzig":"RB Leipzig",
  "rbl":"RB Leipzig",
  "eintracht frankfurt":"Eintracht Frankfurt",
  "vfb stuttgart":"VfB Stuttgart",
  "stuttgart":"VfB Stuttgart",
  "sc freiburg":"SC Freiburg",
  "freiburg":"SC Freiburg",
  "1899 hoffenheim":"TSG 1899 Hoffenheim",
  "tsg hoffenheim":"TSG 1899 Hoffenheim",
  "hoffenheim":"TSG 1899 Hoffenheim",
  "werder bremen":"SV Werder Bremen",
  "bremen":"SV Werder Bremen",
  "vfl wolfsburg":"VfL Wolfsburg",
  "wolfsburg":"VfL Wolfsburg",
  "borussia monchengladbach":"Borussia Mönchengladbach",
  "borussia mönchengladbach":"Borussia Mönchengladbach",
  "monchengladbach":"Borussia Mönchengladbach",
  "mönchengladbach":"Borussia Mönchengladbach",
  "mainz":"1. FSV Mainz 05",
  "mainz 05":"1. FSV Mainz 05",
  "1. fsv mainz 05":"1. FSV Mainz 05",
  "fc augsburg":"FC Augsburg",
  "augsburg":"FC Augsburg",
  "union berlin":"1. FC Union Berlin",
  "1. fc union berlin":"1. FC Union Berlin",
  "fc st pauli":"FC St. Pauli",
  "st pauli":"FC St. Pauli",
  "heidenheim":"1. FC Heidenheim",
  "1. fc heidenheim":"1. FC Heidenheim",
  "holstein kiel":"Holstein Kiel",
  "1. fc koln":"1. FC Köln",
  "1. fc köln":"1. FC Köln",
  "koln":"1. FC Köln",
  "köln":"1. FC Köln",
  "hamburger sv":"Hamburger SV",
  "hamburg":"Hamburger SV",
  "hertha berlin":"Hertha BSC",
  "hertha bsc":"Hertha BSC",
  "schalke 04":"FC Schalke 04",
  "fc schalke 04":"FC Schalke 04",
  "hannover 96":"Hannover 96",
  "fortuna dusseldorf":"Fortuna Düsseldorf",
  "fortuna düsseldorf":"Fortuna Düsseldorf",
  "karlsruher sc":"Karlsruher SC",
  "nurnberg":"1. FC Nürnberg",
  "nürnberg":"1. FC Nürnberg",
  "1. fc nurnberg":"1. FC Nürnberg",
  "1. fc nürnberg":"1. FC Nürnberg",
  "inter milan":"Inter Milan",
  "internazionale":"Inter Milan",
  "ac milan":"AC Milan",
  "juventus":"Juventus FC",
  "paris saint-germain":"Paris Saint-Germain FC",
  "psg":"Paris Saint-Germain FC"
};

const LOCAL_WIKI_FILE_LOGOS = {
  team: {
    "fc bayern munich": {host:"https://es.wikipedia.org/w/api.php", file:"FC Bayern München logo (2024).svg"},
    "bayern munich": {host:"https://es.wikipedia.org/w/api.php", file:"FC Bayern München logo (2024).svg"},
    "bayern münchen": {host:"https://es.wikipedia.org/w/api.php", file:"FC Bayern München logo (2024).svg"}
  },
  competition: {}
};

const EXACT_WIKI_ARTICLES = {
  team: {
    "fc bayern munich": {host:"https://de.wikipedia.org/w/api.php", title:"FC Bayern München"},
    "bayern munich": {host:"https://de.wikipedia.org/w/api.php", title:"FC Bayern München"},
    "bayern münchen": {host:"https://de.wikipedia.org/w/api.php", title:"FC Bayern München"},
    "borussia dortmund": {host:"https://de.wikipedia.org/w/api.php", title:"Borussia Dortmund"},
    "bayer 04 leverkusen": {host:"https://de.wikipedia.org/w/api.php", title:"Bayer 04 Leverkusen"},
    "rb leipzig": {host:"https://de.wikipedia.org/w/api.php", title:"RB Leipzig"},
    "eintracht frankfurt": {host:"https://de.wikipedia.org/w/api.php", title:"Eintracht Frankfurt"},
    "vfb stuttgart": {host:"https://de.wikipedia.org/w/api.php", title:"VfB Stuttgart"},
    "sc freiburg": {host:"https://de.wikipedia.org/w/api.php", title:"SC Freiburg"},
    "tsg 1899 hoffenheim": {host:"https://de.wikipedia.org/w/api.php", title:"TSG 1899 Hoffenheim"},
    "sv werder bremen": {host:"https://de.wikipedia.org/w/api.php", title:"Werder Bremen"},
    "vfl wolfsburg": {host:"https://de.wikipedia.org/w/api.php", title:"VfL Wolfsburg"},
    "borussia mönchengladbach": {host:"https://de.wikipedia.org/w/api.php", title:"Borussia Mönchengladbach"},
    "1. fsv mainz 05": {host:"https://de.wikipedia.org/w/api.php", title:"1. FSV Mainz 05"},
    "fc augsburg": {host:"https://de.wikipedia.org/w/api.php", title:"FC Augsburg"},
    "1. fc union berlin": {host:"https://de.wikipedia.org/w/api.php", title:"1. FC Union Berlin"},
    "fc st. pauli": {host:"https://de.wikipedia.org/w/api.php", title:"FC St. Pauli"},
    "1. fc heidenheim": {host:"https://de.wikipedia.org/w/api.php", title:"1. FC Heidenheim"},
    "holstein kiel": {host:"https://de.wikipedia.org/w/api.php", title:"Holstein Kiel"},
    "1. fc köln": {host:"https://de.wikipedia.org/w/api.php", title:"1. FC Köln"},
    "hamburger sv": {host:"https://de.wikipedia.org/w/api.php", title:"Hamburger SV"},
    "hertha bsc": {host:"https://de.wikipedia.org/w/api.php", title:"Hertha BSC"},
    "fc schalke 04": {host:"https://de.wikipedia.org/w/api.php", title:"FC Schalke 04"},
    "hannover 96": {host:"https://de.wikipedia.org/w/api.php", title:"Hannover 96"},
    "fortuna düsseldorf": {host:"https://de.wikipedia.org/w/api.php", title:"Fortuna Düsseldorf"},
    "karlsruher sc": {host:"https://de.wikipedia.org/w/api.php", title:"Karlsruher SC"},
    "1. fc nürnberg": {host:"https://de.wikipedia.org/w/api.php", title:"1. FC Nürnberg"}
  },
  competition: {
    "uefa champions league": {host:"https://en.wikipedia.org/w/api.php", title:"UEFA Champions League"},
    "uefa europa league": {host:"https://en.wikipedia.org/w/api.php", title:"UEFA Europa League"},
    "uefa conference league": {host:"https://en.wikipedia.org/w/api.php", title:"UEFA Conference League"},
    "premier league": {host:"https://en.wikipedia.org/w/api.php", title:"Premier League"},
    "bundesliga": {host:"https://de.wikipedia.org/w/api.php", title:"Fußball-Bundesliga"},
    "2. bundesliga": {host:"https://de.wikipedia.org/w/api.php", title:"2. Fußball-Bundesliga"},
    "dfb-pokal": {host:"https://de.wikipedia.org/w/api.php", title:"DFB-Pokal"},
    "serie a": {host:"https://en.wikipedia.org/w/api.php", title:"Serie A"},
    "la liga": {host:"https://en.wikipedia.org/w/api.php", title:"La Liga"},
    "ligue 1": {host:"https://en.wikipedia.org/w/api.php", title:"Ligue 1"},
    "fa cup": {host:"https://en.wikipedia.org/w/api.php", title:"FA Cup"},
    "efl cup": {host:"https://en.wikipedia.org/w/api.php", title:"EFL Cup"},
    "copa del rey": {host:"https://en.wikipedia.org/w/api.php", title:"Copa del Rey"},
    "coppa italia": {host:"https://en.wikipedia.org/w/api.php", title:"Coppa Italia"},
    "uefa nations league": {host:"https://en.wikipedia.org/w/api.php", title:"UEFA Nations League"}
  }
};

const COMPETITION_VISUAL_ALIASES = {
  "uefa champions league":"UEFA Champions League",
  "champions league":"UEFA Champions League",
  "uefa europa league":"UEFA Europa League",
  "europa league":"UEFA Europa League",
  "uefa conference league":"UEFA Conference League",
  "premier league":"Premier League",
  "bundesliga":"Bundesliga",
  "2. bundesliga":"2. Bundesliga",
  "dfb-pokal":"DFB-Pokal",
  "dfb pokal":"DFB-Pokal",
  "serie a":"Serie A",
  "laliga":"La Liga",
  "la liga":"La Liga",
  "ligue 1":"Ligue 1",
  "fa cup":"FA Cup",
  "efl cup":"EFL Cup",
  "carabao cup":"EFL Cup",
  "copa del rey":"Copa del Rey",
  "coppa italia":"Coppa Italia",
  "dfb-pokal":"DFB-Pokal",
  "dfb pokal":"DFB-Pokal",
  "uefa nations league":"UEFA Nations League",
  "australian open":"Australian Open",
  "roland garros":"French Open",
  "french open":"French Open",
  "wimbledon":"Wimbledon Championships",
  "us open":"US Open tennis"
};

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

const EDITORIAL_COMPETITIONS = [
  {key:"champions",label:"UEFA Champions League",sport:"Football",priority:1,aliases:["uefa champions league","champions league"]},
  {key:"premier",label:"Premier League",sport:"Football",priority:2,aliases:["premier league"],countryNames:["england"],countryCodes:["GB","ENG"]},
  {key:"bundesliga",label:"Bundesliga",sport:"Football",priority:3,aliases:["bundesliga"],excludeAliases:["2. bundesliga","2 bundesliga"],countryNames:["germany"],countryCodes:["DE","DEU"]},
  {key:"bundesliga2",label:"2. Bundesliga",sport:"Football",priority:4,aliases:["2. bundesliga","2 bundesliga","bundesliga 2"],countryNames:["germany"],countryCodes:["DE","DEU"]},
  {key:"seriea",label:"Serie A",sport:"Football",priority:5,aliases:["serie a"],countryNames:["italy"],countryCodes:["IT","ITA"]},
  {key:"laliga",label:"LaLiga",sport:"Football",priority:6,aliases:["laliga","la liga","primera division"],countryNames:["spain"],countryCodes:["ES","ESP"]},
  {key:"europa",label:"UEFA Europa League",sport:"Football",priority:7,aliases:["uefa europa league","europa league"]},
  {key:"conference",label:"UEFA Conference League",sport:"Football",priority:8,aliases:["uefa conference league","conference league","europa conference league"]},
  {key:"ligue1",label:"Ligue 1",sport:"Football",priority:9,aliases:["ligue 1"],countryNames:["france"],countryCodes:["FR","FRA"]},
  {key:"facup",label:"FA Cup",sport:"Football",priority:10,aliases:["fa cup"],countryNames:["england"],countryCodes:["GB","ENG"]},
  {key:"carabao",label:"Carabao Cup",sport:"Football",priority:11,aliases:["carabao cup","efl cup","league cup"],countryNames:["england"],countryCodes:["GB","ENG"]},
  {key:"dfbpokal",label:"DFB-Pokal",sport:"Football",priority:12,aliases:["dfb-pokal","dfb pokal"],countryNames:["germany"],countryCodes:["DE","DEU"]},
  {key:"coppa_italia",label:"Coppa Italia",sport:"Football",priority:13,aliases:["coppa italia"],countryNames:["italy"],countryCodes:["IT","ITA"]},
  {key:"copa_del_rey",label:"Copa del Rey",sport:"Football",priority:14,aliases:["copa del rey"],countryNames:["spain"],countryCodes:["ES","ESP"]},
  {key:"eredivisie",label:"Eredivisie",sport:"Football",priority:15,aliases:["eredivisie"],countryNames:["netherlands","holland"],countryCodes:["NL","NLD"]},
  {key:"primeira_liga",label:"Primeira Liga",sport:"Football",priority:16,aliases:["primeira liga","liga portugal"],countryNames:["portugal"],countryCodes:["PT","PRT"]},
  {key:"saudi_pro",label:"Saudi Pro League",sport:"Football",priority:17,aliases:["saudi pro league","saudi professional league"],countryNames:["saudi arabia"],countryCodes:["SA","SAU"]},
  {key:"nations",label:"UEFA Nations League",sport:"Football",priority:18,aliases:["uefa nations league","nations league"]},
  {key:"world_cup",label:"World Cup",sport:"Football",priority:19,aliases:["fifa world cup","world cup"],excludeAliases:["qualifier","qualification","women"]},
  {key:"world_cup_qual",label:"World Cup Qualifiers",sport:"Football",priority:20,aliases:["world cup qualification","world cup qualifiers","world cup qualifier"]},
  {key:"euro",label:"UEFA Euro",sport:"Football",priority:21,aliases:["uefa euro","european championship"],excludeAliases:["qualification","qualifier"]},
  {key:"euro_qual",label:"Euro Qualifiers",sport:"Football",priority:22,aliases:["euro qualification","euro qualifiers","european championship qualification"]},

  {key:"nhl",label:"NHL",sport:"Ice Hockey",priority:1,aliases:["nhl","national hockey league"]},
  {key:"nba",label:"NBA",sport:"Basketball",priority:1,aliases:["nba","national basketball association"]},
  {key:"nfl",label:"NFL",sport:"American Football",priority:1,aliases:["nfl","national football league"]},
  {key:"afl",label:"AFL",sport:"Australian Rules",priority:1,aliases:["afl","australian football league"]},
  {key:"nrl",label:"NRL",sport:"Rugby League",priority:1,aliases:["nrl","national rugby league"]},
  {key:"ipl",label:"IPL",sport:"Cricket",priority:1,aliases:["indian premier league","ipl"]},
  {key:"cricket_intl",label:"International Cricket",sport:"Cricket",priority:2,aliases:["international","test series","odi","t20 international","world cup"]},
  {key:"six_nations",label:"Six Nations",sport:"Rugby Union",priority:1,aliases:["six nations"]},
  {key:"rugby_world_cup",label:"Rugby World Cup",sport:"Rugby Union",priority:2,aliases:["rugby world cup","world cup"]},
  {key:"formula1",label:"Formula 1",sport:"Motorsport",priority:1,aliases:["formula 1","formula one","f1"]},
  {key:"australianopen",label:"Australian Open",sport:"Tennis",priority:1,aliases:["australian open"]},
  {key:"rolandgarros",label:"Roland Garros",sport:"Tennis",priority:2,aliases:["roland garros","french open"]},
  {key:"wimbledon",label:"Wimbledon",sport:"Tennis",priority:3,aliases:["wimbledon"]},
  {key:"usopen",label:"US Open",sport:"Tennis",priority:4,aliases:["us open"]},
  {key:"masters1000",label:"ATP Masters 1000",sport:"Tennis",priority:5,aliases:["masters 1000","atp masters","indian wells","miami open","monte carlo masters","madrid open","italian open","canadian open","cincinnati open","shanghai masters","paris masters"]}
];

function normalizedCompetitionText(value=""){
  return normalizeSearchText(value).replace(/[._-]+/g," ").replace(/\s+/g," ").trim();
}

function editorialCompetitionFor(match){
  const tournamentName=normalizedCompetitionText(match?.tournament?.name || "");
  const categoryName=normalizedCompetitionText(match?.tournament?.category?.name || "");
  const sportName=normalizedCompetitionText(match?.tournament?.sport?.name || match?.sport?.name || "");
  const sportKey=normalizedCompetitionText(match?.tournament?.sport?.key || match?.sport?.key || "");
  const haystack=[tournamentName,categoryName].filter(Boolean).join(" ");

  const categoryCountryCode=String(match?.tournament?.category?.country_code || match?.tournament?.category?.countryCode || "").trim().toUpperCase();
  const countryMatches=(def)=>{
    const names=(def.countryNames||[]).map(normalizedCompetitionText);
    const codes=(def.countryCodes||[]).map(x=>String(x).toUpperCase());
    if(!names.length&&!codes.length) return true;

    // Prefer the API category name because generic country codes such as GB can cover
    // multiple football associations. Only fall back to the code when the name is absent.
    if(categoryName){
      return names.some(name=>categoryName===name || categoryName.startsWith(name+" ") || categoryName.includes(" "+name+" "));
    }
    return Boolean(categoryCountryCode && codes.includes(categoryCountryCode));
  };

  const sportMatches=(def)=>{
    const wanted=normalizedCompetitionText(def.sport);
    if(def.sport==="Football") return /soccer|football/.test(sportName+" "+sportKey) && !/american|australian/.test(sportName+" "+sportKey);
    if(def.sport==="Ice Hockey") return /ice hockey|hockey/.test(sportName+" "+sportKey);
    if(def.sport==="Basketball") return /basketball/.test(sportName+" "+sportKey);
    if(def.sport==="American Football") return /american football/.test(sportName+" "+sportKey);
    if(def.sport==="Australian Rules") return /australian|aussie rules/.test(sportName+" "+sportKey);
    if(def.sport==="Rugby League") return /rugby league/.test(sportName+" "+sportKey);
    if(def.sport==="Rugby Union") return /rugby union/.test(sportName+" "+sportKey) || (/rugby/.test(sportName+" "+sportKey) && !/league/.test(sportName+" "+sportKey));
    if(def.sport==="Cricket") return /cricket/.test(sportName+" "+sportKey);
    if(def.sport==="Motorsport") return /motor|formula|racing/.test(sportName+" "+sportKey);
    if(def.sport==="Tennis") return /tennis/.test(sportName+" "+sportKey);
    return (sportName+" "+sportKey).includes(wanted);
  };

  for(const def of EDITORIAL_COMPETITIONS){
    if(!sportMatches(def)) continue;
    if(!countryMatches(def)) continue;
    if((def.excludeAliases||[]).some(a=>haystack.includes(normalizedCompetitionText(a)))) continue;
    if(def.aliases.some(a=>tournamentName.includes(normalizedCompetitionText(a)))) return def;
  }
  return null;
}

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
  const n=Number(value);
  if(!Number.isFinite(n) || n<=0) return "";
  const dec=n>100 ? n/1000 : n;
  return dec.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
}

function outcomeOddValue(outcome){
  if(!outcome || typeof outcome!=="object") return "";
  const raw=
    outcome.odds ??
    outcome.decimal_odds ??
    outcome.decimalOdds ??
    outcome.price ??
    outcome.value ??
    outcome.coefficient;
  return decimalOdd(raw);
}

function marketOutcomeList(market){
  if(!market || typeof market!=="object") return [];
  const rows=market.outcomes || market.selections || market.options || market.results || [];
  return Array.isArray(rows) ? rows : [];
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
    competitorBySide(match,"home")?.name,
    competitorBySide(match,"away")?.name,
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

function visualAlias(label, kind="team") {
  const key=String(label||"").toLowerCase().trim();
  return kind==="competition"
    ? (COMPETITION_VISUAL_ALIASES[key] || label)
    : (TEAM_VISUAL_ALIASES[key] || label);
}

async function localWikiFileThumbnail(host, filename){
  if(!host||!filename) return "";
  const key=("local-wiki-file-v1|"+host+"|"+filename).toLowerCase();
  const hit=wikiImageCache.get(key);
  if(hit && Date.now()-hit.createdAt<7*24*60*60*1000) return hit.url||"";
  try{
    const url=new URL(host);
    url.searchParams.set("action","query");
    url.searchParams.set("format","json");
    url.searchParams.set("formatversion","2");
    url.searchParams.set("titles","File:"+filename);
    url.searchParams.set("prop","imageinfo");
    url.searchParams.set("iiprop","url");
    url.searchParams.set("iiurlwidth","220");
    const response=await fetch(url,{headers:{Accept:"application/json","User-Agent":"BetandplayContentHub/2.0"}});
    if(!response.ok) return "";
    const body=await response.json();
    const info=body?.query?.pages?.[0]?.imageinfo?.[0];
    const out=info?.thumburl||info?.url||"";
    wikiImageCache.set(key,{createdAt:Date.now(),url:out});
    return out;
  }catch{return ""}
}

async function exactWikiArticleThumbnail(host,title){
  if(!host||!title) return "";
  const key=("exact-wiki-pageimage-v1|"+host+"|"+title).toLowerCase();
  const hit=wikiImageCache.get(key);
  if(hit&&Date.now()-hit.createdAt<7*24*60*60*1000) return hit.url||"";
  try{
    const url=new URL(host);
    url.searchParams.set("action","query");
    url.searchParams.set("format","json");
    url.searchParams.set("formatversion","2");
    url.searchParams.set("titles",title);
    url.searchParams.set("prop","pageimages");
    url.searchParams.set("piprop","thumbnail");
    url.searchParams.set("pithumbsize","220");
    url.searchParams.set("pilicense","any");
    const response=await fetch(url,{headers:{Accept:"application/json","User-Agent":"BetandplayContentHub/2.0"}});
    if(!response.ok) return "";
    const body=await response.json();
    const out=body?.query?.pages?.[0]?.thumbnail?.source||"";
    wikiImageCache.set(key,{createdAt:Date.now(),url:out});
    return out;
  }catch{return ""}
}

async function wikiPageEntityId(label, kind="team", context="") {
  const canonical=visualAlias(label,kind);
  const exact=EXACT_WIKI_ARTICLES[kind]?.[String(canonical||"").toLowerCase()] || EXACT_WIKI_ARTICLES[kind]?.[String(label||"").toLowerCase()];
  const useGermanWiki=kind==="team" && /german|deutsch|bundesliga|dfb/i.test(context||"");
  const host=exact?.host || (useGermanWiki ? "https://de.wikipedia.org/w/api.php" : "https://en.wikipedia.org/w/api.php");
  const title=exact?.title || canonical;
  const cacheKey=("wikidata-entity-v3|"+host+"|"+kind+"|"+title).toLowerCase();
  const hit=wikiImageCache.get(cacheKey);
  if(hit && Date.now()-hit.createdAt < 7*24*60*60*1000) return hit.entityId || "";
  try{
    const url=new URL(host);
    url.searchParams.set("action","query");
    url.searchParams.set("format","json");
    url.searchParams.set("formatversion","2");
    url.searchParams.set("titles",title);
    url.searchParams.set("prop","pageprops");
    const response=await fetch(url,{headers:{Accept:"application/json","User-Agent":"BetandplayContentHub/2.0"}});
    if(!response.ok) return "";
    const body=await response.json();
    const entityId=body?.query?.pages?.[0]?.pageprops?.wikibase_item || "";
    wikiImageCache.set(cacheKey,{createdAt:Date.now(),entityId});
    return entityId;
  }catch{return ""}
}

async function wikidataLogoFilename(entityId){
  if(!entityId) return "";
  const cacheKey=("wikidata-p154-v3|"+entityId).toLowerCase();
  const hit=wikiImageCache.get(cacheKey);
  if(hit && Date.now()-hit.createdAt < 7*24*60*60*1000) return hit.filename || "";
  try{
    const response=await fetch("https://www.wikidata.org/wiki/Special:EntityData/"+encodeURIComponent(entityId)+".json",{headers:{Accept:"application/json","User-Agent":"BetandplayContentHub/2.0"}});
    if(!response.ok) return "";
    const body=await response.json();
    const claims=Array.isArray(body?.entities?.[entityId]?.claims?.P154)?body.entities[entityId].claims.P154:[];
    const preferred=claims.find(c=>c?.rank==="preferred") || claims.find(c=>c?.rank!=="deprecated") || claims[0];
    const filename=preferred?.mainsnak?.datavalue?.value || "";
    wikiImageCache.set(cacheKey,{createdAt:Date.now(),filename});
    return typeof filename==="string"?filename:"";
  }catch{return ""}
}

async function commonsFileThumbnail(filename){
  if(!filename) return "";
  const cacheKey=("commons-file-v3|"+filename).toLowerCase();
  const hit=wikiImageCache.get(cacheKey);
  if(hit && Date.now()-hit.createdAt < 7*24*60*60*1000) return hit.url || "";
  try{
    const url=new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action","query");
    url.searchParams.set("format","json");
    url.searchParams.set("formatversion","2");
    url.searchParams.set("titles","File:"+filename);
    url.searchParams.set("prop","imageinfo");
    url.searchParams.set("iiprop","url");
    url.searchParams.set("iiurlwidth","220");
    const response=await fetch(url,{headers:{Accept:"application/json","User-Agent":"BetandplayContentHub/2.0"}});
    if(!response.ok) return "";
    const body=await response.json();
    const info=body?.query?.pages?.[0]?.imageinfo?.[0];
    const out=info?.thumburl||info?.url||"";
    wikiImageCache.set(cacheKey,{createdAt:Date.now(),url:out});
    return out;
  }catch{return ""}
}

async function resolveEntityVisual(label,kind="team",context=""){
  const canonical=visualAlias(label,kind);
  const local=LOCAL_WIKI_FILE_LOGOS[kind]?.[String(canonical||"").toLowerCase()] || LOCAL_WIKI_FILE_LOGOS[kind]?.[String(label||"").toLowerCase()];
  if(local){
    const url=await localWikiFileThumbnail(local.host,local.file);
    if(url)return url;
  }
  const exact=EXACT_WIKI_ARTICLES[kind]?.[String(canonical||"").toLowerCase()] || EXACT_WIKI_ARTICLES[kind]?.[String(label||"").toLowerCase()];
  if(exact){
    const url=await exactWikiArticleThumbnail(exact.host,exact.title);
    if(url)return url;
  }
  const entityId=await wikiPageEntityId(label,kind,context);
  if(!entityId)return "";
  const filename=await wikidataLogoFilename(entityId);
  if(!filename)return "";
  return commonsFileThumbnail(filename);
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

function responseRows(body){
  if(Array.isArray(body)) return body;
  if(Array.isArray(body?.data)) return body.data;
  if(Array.isArray(body?.matches)) return body.matches;
  if(Array.isArray(body?.items)) return body.items;
  if(Array.isArray(body?.results)) return body.results;
  if(Array.isArray(body?.data?.matches)) return body.data.matches;
  if(Array.isArray(body?.data?.items)) return body.data.items;
  if(Array.isArray(body?.data?.results)) return body.data.results;
  return [];
}

async function fetchJsonWithTimeout(url, timeoutMs=5000) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{
      headers:{
        Accept:"application/json, text/plain, */*",
        "Accept-Language":"en",
        "User-Agent":"Mozilla/5.0 Chrome/126 Safari/537.36",
        Referer:"https://www.betandplay.com/",
        Origin:"https://www.betandplay.com"
      },
      signal:controller.signal
    });
    const text=await response.text();
    let body=text;
    try{body=JSON.parse(text)}catch{}
    if(!response.ok){
      const error=new Error("upstream_"+response.status);
      error.status=response.status;
      error.body=body;
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

  const url = new URL(UPSTREAM_V3 + "/matches");
  url.searchParams.set("type", "match");
  url.searchParams.set("sport_key", sportKey);
  url.searchParams.set("bettable", "true");
  url.searchParams.set("start_from", start);
  url.searchParams.set("start_to", end);
  url.searchParams.set("limit", "100");

  const body = await fetchJson(url);
  const matches=responseRows(body);

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

  const outcomes=marketOutcomeList(node);
  const marketName=node.name || node.market_name || node.marketName || node.label || node.key || node.market_key;
  if(outcomes.length && marketName) out.push({...node,outcomes});

  for(const value of Object.values(node)) {
    if (value && typeof value === "object") collectMarketObjects(value,out);
  }
  return out;
}

function marketOutcomeToOdd(outcome) {
  if(!outcome || outcome?.active===false) return null;
  const value=outcomeOddValue(outcome);
  if(!value) return null;
  const label=outcome.name || outcome.label || outcome.selection_name || outcome.selectionName || outcome.key || "Selection";
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
  const selections = marketOutcomeList(market)
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

function normalizeMarketsForDrawer(markets) {
  const groups = new Map();
  for (const market of markets || []) {
    const name=String(market?.name || market?.market_name || market?.label || market?.key || "Other");
    const family=marketFamily(name);
    const selections=(market?.outcomes || []).map(marketOutcomeToOdd).filter(Boolean).filter(x=>Number.isFinite(Number(x.value)));
    if(!selections.length) continue;
    const key=family==="other" ? name : family;
    if(!groups.has(key)) groups.set(key,{key,family,name,markets:[]});
    groups.get(key).markets.push({name,selections:selections.slice(0,12)});
  }
  const order=["result","goals_total","btts","double_chance","draw_no_bet","handicap","team_total","corners","cards","qualify","first_goal","half_time","second_half","clean_sheet","player_prop","correct_score"];
  return [...groups.values()].sort((a,b)=>{
    const ai=order.indexOf(a.family), bi=order.indexOf(b.family);
    return (ai<0?999:ai)-(bi<0?999:bi);
  }).slice(0,24);
}

async function fetchMatchMarkets(matchId) {
  const url = new URL(UPSTREAM + "/matches/" + encodeURIComponent(matchId) + "/markets");
  url.searchParams.set("limit","200");
  const body = await fetchJson(url);
  return collectMarketObjects(body,[]);
}

function sportsbookLogoUrl(raw="") {
  const value=String(raw||"").trim();
  if(!value) return "";
  if(/^https?:\/\//i.test(value)) return value;
  if(value.startsWith("/")) return SPORTSBOOK_ORIGIN + value;
  return SPORTSBOOK_ORIGIN + "/" + value.replace(/^\/+/, "");
}

function normalizedCompetitorEntity(entity){
  if(!entity) return null;
  if(typeof entity==="string") return {name:entity};
  if(entity.competitor && typeof entity.competitor==="object") return entity.competitor;
  if(entity.team && typeof entity.team==="object") return entity.team;
  return entity;
}

function competitorEntries(match) {
  const candidates=[];
  const push=v=>{
    if(Array.isArray(v)) v.forEach(push);
    else {
      const e=normalizedCompetitorEntity(v);
      if(e && (e.name || e.id)) candidates.push(e);
    }
  };

  const c=match?.competitors;
  if(Array.isArray(c)) push(c);
  else if(c && typeof c==="object"){
    push(c.home); push(c.away); push(c.host); push(c.guest);
    push(c.home_team); push(c.away_team);
    push(c.homeTeam); push(c.awayTeam);
    for(const v of Object.values(c)) push(v);
  }

  push(match?.home_competitor); push(match?.away_competitor);
  push(match?.home_team); push(match?.away_team);
  push(match?.homeTeam); push(match?.awayTeam);
  push(match?.home); push(match?.away);
  push(match?.teams?.home); push(match?.teams?.away);

  const seen=new Set();
  return candidates.filter(e=>{
    const key=String(e.id ?? e.urn_id ?? e.name ?? "").toLowerCase();
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function competitorBySide(match,side) {
  const c=match?.competitors;
  const direct=side==="home"
    ? [c?.home,c?.host,c?.home_team,c?.homeTeam,match?.home_competitor,match?.home_team,match?.homeTeam,match?.home,match?.teams?.home]
    : [c?.away,c?.guest,c?.away_team,c?.awayTeam,match?.away_competitor,match?.away_team,match?.awayTeam,match?.away,match?.teams?.away];
  for(const raw of direct){
    const e=normalizedCompetitorEntity(raw);
    if(e?.name) return e;
  }

  const list=competitorEntries(match);
  const patterns=side==="home"
    ? /^(home|host|1)$/i
    : /^(away|guest|2)$/i;
  const byQualifier=list.find(e=>patterns.test(String(e?.type ?? e?.side ?? e?.qualifier ?? e?.position ?? "")));
  if(byQualifier) return byQualifier;
  return side==="home" ? (list[0]||null) : (list[1]||null);
}

function matchNameTeams(match){
  const name=String(match?.name || match?.title || "").trim();
  if(!name) return [];
  const parts=name.split(/\s+(?:vs\.?|v\.?|-|–|—)\s+/i).map(x=>x.trim()).filter(Boolean);
  return parts.length===2 ? parts : [];
}

function extractOfficialLogo(entity) {
  return sportsbookLogoUrl(entity?.logo || entity?.logo_url || entity?.logoUrl || entity?.image || entity?.image_url || entity?.imageUrl || "");
}

function mainMarketForMatch(match){
  if(match?.main_market) return match.main_market;
  if(match?.mainMarket) return match.mainMarket;
  if(match?.markets?.main) return match.markets.main;
  if(Array.isArray(match?.markets)){
    const result=match.markets.find(m=>/^(1x2|match result|moneyline|winner|full time result)$/i.test(String(m?.name||m?.label||m?.key||"")));
    return result || match.markets[0] || null;
  }
  return null;
}

function toBigEvent(match) {
  const post=toPost(match);
  const category=match?.tournament?.category || {};
  const homeEntity=competitorBySide(match,"home");
  const awayEntity=competitorBySide(match,"away");
  const logoEntities=[homeEntity,awayEntity];

  return {
    ...post,
    country: category?.country_code || category?.countryCode || category?.name || "",
    tournamentId: match?.tournament?.id || null,
    teamNames:post.teamNames||[],
    teamLogos:(post.teamNames||[]).map((name,i)=>({
      name,
      url:extractOfficialLogo(logoEntities[i])
    })),
    competitionLogo: extractOfficialLogo(match?.tournament),
    logoSource:"sportsbook-v3"
  };
}

function toPost(match) {
  const homeEntity=competitorBySide(match,"home");
  const awayEntity=competitorBySide(match,"away");
  const namedPair=matchNameTeams(match);
  const home=String(homeEntity?.name || namedPair[0] || "").trim();
  const away=String(awayEntity?.name || namedPair[1] || "").trim();
  const isHeadToHead=Boolean(home && away);
  const title=isHeadToHead
    ? home+" vs "+away
    : (match?.name || match?.title || match?.tournament?.name || "Sports event");
  const competition=match?.tournament?.name || match?.competition?.name || "Sport";
  const startTime=match?.start_time || match?.startTime || match?.starts_at || match?.startsAt || null;
  const time=startTime
    ? new Intl.DateTimeFormat("en-GB",{
        timeZone:"Europe/Malta",
        day:"2-digit",
        month:"short",
        hour:"2-digit",
        minute:"2-digit",
        hour12:false
      }).format(new Date(startTime)).replace(","," ·")+" CEST"
    : "";

  const mainMarket=mainMarketForMatch(match);
  const odds=marketOutcomeList(mainMarket)
    .filter(o=>o?.active!==false)
    .map(o=>({
      label:o?.name || o?.label || o?.selection_name || o?.selectionName || "Selection",
      value:outcomeOddValue(o)
    }))
    .filter(o=>o.value)
    .slice(0,3);

  const secondaryMarket=match?.secondary_market || match?.secondaryMarket || match?.markets?.secondary;
  if(odds.length<3){
    const secondary=marketOutcomeList(secondaryMarket)
      .filter(o=>o?.active!==false)
      .map(o=>({
        label:o?.name || o?.label || o?.selection_name || o?.selectionName || "Selection",
        value:outcomeOddValue(o)
      }))
      .find(o=>o.value);
    if(secondary) odds.push(secondary);
  }

  return {
    id:String(match?.id ?? match?.match_id ?? ""),
    title,
    isHeadToHead,
    competition,
    sport:match?.tournament?.sport?.name || match?.sport?.name || match?.sport_name || "Sport",
    sportKey:match?.tournament?.sport?.key || match?.sport?.key || match?.sport_key || "",
    startTime,
    time,
    teamNames:isHeadToHead ? [home,away] : [],
    odds,
    bettingOptions:[]
  };
}

function contentPrefs(body={}) {
  return {
    channel:["Telegram","Email","Push"].includes(body.channel) ? body.channel : "Telegram",
    language:["EN","DE","IT","ES"].includes(body.language) ? body.language : "EN",
    tone:["Sports","Hype","Informative"].includes(body.tone) ? body.tone : "Sports",
    contentType:["Match Post","Value Bet","Acca"].includes(body.contentType) ? body.contentType : "Match Post"
  };
}

function copyLexicon(language="EN") {
  const map={
    EN:{kick:"Kick-off",comp:"Competition",main:"MAIN ODDS",markets:"MARKETS TO WATCH",extra:"Extra angle",check:"CHECK THE MATCH ON BETANDPLAY",ideas:"BET IDEAS",full:"CHECK THE FULL MATCH MARKET ON BETANDPLAY"},
    DE:{kick:"Anstoß",comp:"Wettbewerb",main:"HAUPTQUOTEN",markets:"MÄRKTE IM BLICK",extra:"Weitere Option",check:"JETZT BEI BETANDPLAY CHECKEN",ideas:"WETTIDEEN",full:"ALLE MÄRKTE BEI BETANDPLAY CHECKEN"},
    IT:{kick:"Calcio d'inizio",comp:"Competizione",main:"QUOTE PRINCIPALI",markets:"MERCATI DA SEGUIRE",extra:"Altra opzione",check:"SCOPRI IL MATCH SU BETANDPLAY",ideas:"IDEE DI SCOMMESSA",full:"SCOPRI TUTTI I MERCATI SU BETANDPLAY"},
    ES:{kick:"Inicio",comp:"Competición",main:"CUOTAS PRINCIPALES",markets:"MERCADOS A SEGUIR",extra:"Otra opción",check:"MIRA EL PARTIDO EN BETANDPLAY",ideas:"IDEAS DE APUESTA",full:"MIRA TODOS LOS MERCADOS EN BETANDPLAY"}
  };
  return map[language] || map.EN;
}

function buildVariantPost(p, style="short", prefs={}) {
  const options = Array.isArray(p.bettingOptions) ? p.bettingOptions : [];
  const main = (p.odds || []).slice(0,3);
  const lex = copyLexicon(prefs.language || "EN");
  const extra = options.slice(0,6);
  const mainLines = main.map(o=>"• "+o.label+" — "+o.value).join("\n");
  const extraLines = extra.map(o=>"• "+o.market+": "+o.label+" @ "+o.value).join("\n");

  if (style === "short") {
    return (
      "🔥 "+p.title+"\n\n"+
      (p.time ? "⏰ "+lex.kick+": "+p.time+"\n" : "")+
      "🏆 "+lex.comp+": "+p.competition+"\n\n"+
      (mainLines ? lex.main+"\n"+mainLines+"\n\n" : "")+
      (extra[0] ? lex.extra+": "+extra[0].market+" — "+extra[0].label+" @ "+extra[0].value+"\n\n" : "")+
      "👉 "+lex.check
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
      (recommended.length ? lex.ideas+"\n"+recommended.map((o,i)=>(i+1)+". "+o.market+": "+o.label+" @ "+o.value).join("\n")+"\n\n" : "")+
      "🔥 Our approach: don't just look at the 1X2 — check the goals and alternative markets before kick-off.\n\n"+
      "👉 "+(prefs.contentType==="Acca" ? "BUILD YOUR ACCA ON BETANDPLAY" : lex.check)
    );
  }

  return (
    "🏆 MATCH PREVIEW: "+p.title+"\n\n"+
    p.title+" is one of the standout fixtures coming up in "+p.competition+". Rather than looking only at the match result, the current Betandplay board gives us a few different ways to approach it.\n\n"+
    (p.time ? "⏰ Kick-off: "+p.time+"\n\n" : "")+
    (mainLines ? lex.main+"\n"+mainLines+"\n\n" : "")+
    (extraLines ? lex.markets+"\n"+extraLines+"\n\n" : "")+
    "The straight result gives the basic shape of the market, but goals, BTTS, handicaps and other alternatives can offer a very different angle depending on how you expect the game to develop.\n\n"+
    "If you prefer a simpler bet, stick to the main market. If you're expecting a more open game, the goal-related markets are worth checking before the price moves. 👀\n\n"+
    "👉 "+lex.full
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

async function getAvailableTournaments(start,end){
  const key="available-tournaments-v3|"+String(start).slice(0,10)+"|"+String(end).slice(0,10);
  const hit=cached(key);
  if(hit) return hit;

  const rows=[];
  for(let page=1;page<=6;page++){
    const url=new URL(UPSTREAM+"/tournaments");
    url.searchParams.set("bettable","true");
    url.searchParams.set("match_status","0");
    url.searchParams.set("start_from",start);
    url.searchParams.set("start_to",end);
    url.searchParams.set("limit","100");
    url.searchParams.set("page",String(page));
    const body=await fetchJson(url);
    const data=responseRows(body);
    rows.push(...data);

    const totalPages=Number(body?.pagination?.total_pages || body?.pagination?.pages || 0);
    if((totalPages && page>=totalPages) || data.length<100) break;
  }

  const deduped=[...new Map(rows.filter(t=>t?.id).map(t=>[String(t.id),t])).values()];
  setCached(key,deduped);
  return deduped;
}

function chunkArray(items,size){
  const out=[];
  for(let i=0;i<items.length;i+=size) out.push(items.slice(i,i+size));
  return out;
}

async function getMatchesForTournamentIds(ids,start,end){
  const fetchIds=async targetIds=>{
    const url=new URL(UPSTREAM_V3+"/matches");
    url.searchParams.set("bettable","true");
    url.searchParams.set("start_from",start);
    url.searchParams.set("start_to",end);
    url.searchParams.set("limit","100");
    for(const id of targetIds) url.searchParams.append("tournament_id",String(id));

    const rows=[];
    for(let page=1;page<=3;page++){
      url.searchParams.set("page",String(page));
      const body=await fetchJson(url);
      const data=responseRows(body);
      rows.push(...data);
      const totalPages=Number(body?.pagination?.total_pages || body?.pagination?.pages || 0);
      if((totalPages && page>=totalPages) || data.length<100) break;
    }
    return rows;
  };

  let rows=await fetchIds(ids);
  // Some sportsbook deployments only honour one tournament_id per request.
  // If a batched query unexpectedly returns nothing, retry per tournament.
  if(!rows.length && ids.length>1){
    const settled=await Promise.allSettled(ids.map(id=>fetchIds([id])));
    rows=settled.flatMap(x=>x.status==="fulfilled"?x.value:[]);
  }
  return rows;
}

async function getEditorialEvents(days=30){
  const start=new Date();
  const endLimit=new Date(start.getTime()+days*24*60*60*1000);
  const startIso=start.toISOString();
  const endIso=endLimit.toISOString();

  const tournaments=await getAvailableTournaments(startIso,endIso);
  const selected=[];
  const defByTournament=new Map();

  for(const tournament of tournaments){
    const def=editorialCompetitionFor({tournament,sport:tournament?.sport});
    if(!def) continue;
    const id=String(tournament?.id||"");
    if(!id || defByTournament.has(id)) continue;
    defByTournament.set(id,def);
    selected.push(tournament);
  }

  if(!selected.length) return [];

  const batches=chunkArray(selected.map(t=>String(t.id)),18);
  const settled=await Promise.allSettled(
    batches.map(ids=>getMatchesForTournamentIds(ids,startIso,endIso))
  );
  const matches=settled.flatMap(x=>x.status==="fulfilled" ? x.value : []);

  const deduped=new Map();
  for(const match of matches){
    if(!match?.id || isWomensEvent(match)) continue;
    const tournamentId=String(match?.tournament?.id||"");
    const def=defByTournament.get(tournamentId) || editorialCompetitionFor(match);
    if(!def) continue;

    const event=toBigEvent(match);
    event.competitionKey=def.key;
    event.competition=def.label;
    event.competitionPriority=def.priority;
    event.sportGroup=def.sport;
    event.sportKey=String(match?.tournament?.sport?.key || match?.sport?.key || event.sportKey || "");
    deduped.set(String(match.id),event);
  }

  const events=[...deduped.values()];
  const germanLogoFallback=new Map();
  const missingGermanTeams=[...new Set(events
    .filter(e=>e.sportGroup==="Football" && ["bundesliga","bundesliga2","dfbpokal"].includes(e.competitionKey))
    .flatMap(e=>(e.teamLogos||[]).filter(x=>!x.url).map(x=>x.name))
    .filter(Boolean))];
  await Promise.all(missingGermanTeams.map(async name=>{
    const url=await resolveEntityVisual(name,"team","German football club");
    if(url) germanLogoFallback.set(name,url);
  }));
  for(const event of events){
    if(!["bundesliga","bundesliga2","dfbpokal"].includes(event.competitionKey)) continue;
    event.teamLogos=(event.teamLogos||[]).map(x=>x.url?x:{...x,url:germanLogoFallback.get(x.name)||""});
    if(event.teamLogos.some(x=>x.url)) event.logoSource="sportsbook-v3+wikipedia";
  }

  const competitionFallback=new Map();
  const missingCompetitions=[...new Map(events.filter(e=>!e.competitionLogo).map(e=>[e.competitionKey,e.competition])).entries()];
  await Promise.all(missingCompetitions.map(async ([key,label])=>{
    const url=await resolveEntityVisual(label,"competition","sports competition");
    if(url) competitionFallback.set(key,url);
  }));
  for(const event of events){
    if(!event.competitionLogo && competitionFallback.has(event.competitionKey)){
      event.competitionLogo=competitionFallback.get(event.competitionKey);
      event.logoSource=(event.logoSource||"sportsbook-v3")+"+wikipedia";
    }
  }

  return events.sort((a,b)=>new Date(a.startTime||0)-new Date(b.startTime||0));
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

function sofaSportKey(sportKey="") {
  const key=String(sportKey||"").toLowerCase();
  if(key==="soccer") return "football";
  if(key==="basketball") return "basketball";
  if(key==="tennis") return "tennis";
  return key || "football";
}

function normalizeSofaName(value="") {
  return normalizeSearchText(value)
    .replace(/\b(fc|cf|ac|ssc|afc|club|calcio|football|futbol|deportivo)\b/g," ")
    .replace(/munchen/g,"munich")
    .replace(/internazionale/g,"inter")
    .replace(/paris saint germain/g,"psg")
    .replace(/manchester utd/g,"manchester united")
    .replace(/manchester city fc/g,"manchester city")
    .replace(/tottenham hotspur/g,"tottenham")
    .replace(/\s+/g," ")
    .trim();
}

function nameSimilarity(a,b) {
  const x=normalizeSofaName(a), y=normalizeSofaName(b);
  if(!x||!y) return 0;
  if(x===y) return 1;
  if(x.includes(y)||y.includes(x)) return 0.9;
  const xs=new Set(x.split(" ").filter(Boolean));
  const ys=new Set(y.split(" ").filter(Boolean));
  const common=[...xs].filter(t=>ys.has(t)).length;
  const union=new Set([...xs,...ys]).size || 1;
  return common/union;
}

async function sofascoreScheduledEvents(sportKey,dateKey) {
  const cacheKey=("sofa-schedule|"+sportKey+"|"+dateKey).toLowerCase();
  const hit=wikiImageCache.get(cacheKey);
  if(hit && Date.now()-hit.createdAt < 6*60*60*1000) return hit.value || [];

  try {
    const sport=sofaSportKey(sportKey);
    const url="https://api.sofascore.com/api/v1/sport/"+encodeURIComponent(sport)+"/scheduled-events/"+encodeURIComponent(dateKey);
    const response=await fetch(url,{
      headers:{
        Accept:"application/json",
        "User-Agent":"BetandplayContentHub/2.0"
      }
    });
    if(!response.ok) return [];
    const body=await response.json();
    const events=Array.isArray(body?.events) ? body.events : [];
    wikiImageCache.set(cacheKey,{createdAt:Date.now(),value:events});
    return events;
  } catch {
    return [];
  }
}

function bestSofascoreEvent(sourceEvent,candidates) {
  const teams=(sourceEvent?.teamNames||[]).slice(0,2);
  if(teams.length<2) return null;

  let best=null;
  let bestScore=0;

  for(const candidate of candidates||[]) {
    const home=candidate?.homeTeam?.name || "";
    const away=candidate?.awayTeam?.name || "";
    const direct=(nameSimilarity(teams[0],home)+nameSimilarity(teams[1],away))/2;
    const reverse=(nameSimilarity(teams[0],away)+nameSimilarity(teams[1],home))/2;
    const score=Math.max(direct,reverse);

    if(score>bestScore){
      bestScore=score;
      best=candidate;
    }
  }

  return bestScore>=0.72 ? best : null;
}

function sofascoreTeamImage(teamId) {
  return teamId ? "/api/logo/team/"+encodeURIComponent(teamId) : "";
}

function sofascoreTournamentImage(tournamentId) {
  return tournamentId ? "/api/logo/tournament/"+encodeURIComponent(tournamentId) : "";
}

async function enrichBigEventsWithSofascore(events) {
  const scheduleKeys=[...new Set((events||[]).map(e=>{
    const date=e?.startTime ? String(e.startTime).slice(0,10) : "";
    return date && e?.sportKey ? e.sportKey+"|"+date : "";
  }).filter(Boolean))];

  const schedules=new Map();
  await Promise.all(scheduleKeys.map(async key=>{
    const [sportKey,date]=key.split("|");
    schedules.set(key,await sofascoreScheduledEvents(sportKey,date));
  }));

  return (events||[]).map(e=>{
    const date=e?.startTime ? String(e.startTime).slice(0,10) : "";
    const candidates=schedules.get((e?.sportKey||"")+"|"+date) || [];
    const matched=bestSofascoreEvent(e,candidates);

    if(!matched){
      return {...e,teamLogos:(e.teamNames||[]).map(name=>({name,url:""})),competitionLogo:"",logoSource:"fallback"};
    }

    const sourceTeams=(e.teamNames||[]).slice(0,2);
    const sofaTeams=[matched?.homeTeam,matched?.awayTeam].filter(Boolean);
    const teamLogos=sourceTeams.map(name=>{
      let bestTeam=null,best=0;
      for(const t of sofaTeams){
        const score=nameSimilarity(name,t?.name||"");
        if(score>best){best=score;bestTeam=t;}
      }
      return {name,url:best>=0.65 ? sofascoreTeamImage(bestTeam?.id) : ""};
    });

    const uniqueTournament=matched?.tournament?.uniqueTournament || {};
    return {
      ...e,
      teamLogos,
      competitionLogo:sofascoreTournamentImage(uniqueTournament?.id),
      logoSource:"sofascore"
    };
  });
}

function findBigEventById(events, matchId) {
  return (events || []).find(e=>String(e.id)===String(matchId));
}

app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "1h",
  setHeaders(res,filePath){
    if(filePath.endsWith("index.html")){
      res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");
    }
  }
}));

app.get("/api/logo/:kind/:id", async (req,res) => {
  const kind=String(req.params.kind||"");
  const id=String(req.params.id||"");
  if(!/^(team|tournament)$/.test(kind) || !/^\d+$/.test(id)) return res.status(400).end();

  const cacheKey=kind+"|"+id;
  const cachedLogo=logoBinaryCache.get(cacheKey);
  if(cachedLogo && Date.now()-cachedLogo.createdAt < 24*60*60*1000){
    res.set("Content-Type",cachedLogo.contentType);
    res.set("Cache-Control","public, max-age=86400");
    return res.send(cachedLogo.buffer);
  }

  const sources=kind==="team"
    ? [
        "https://img.sofascore.com/api/v1/team/"+id+"/image",
        "https://api.sofascore.com/api/v1/team/"+id+"/image"
      ]
    : [
        "https://img.sofascore.com/api/v1/unique-tournament/"+id+"/image/dark",
        "https://api.sofascore.com/api/v1/unique-tournament/"+id+"/image/dark",
        "https://img.sofascore.com/api/v1/unique-tournament/"+id+"/image"
      ];

  for(const source of sources){
    try{
      const response=await fetch(source,{headers:{Accept:"image/*","User-Agent":"BetandplayContentHub/2.0"}});
      if(!response.ok) continue;
      const contentType=response.headers.get("content-type") || "image/png";
      if(!contentType.startsWith("image/")) continue;
      const buffer=Buffer.from(await response.arrayBuffer());
      if(!buffer.length) continue;
      logoBinaryCache.set(cacheKey,{createdAt:Date.now(),contentType,buffer});
      res.set("Content-Type",contentType);
      res.set("Cache-Control","public, max-age=86400");
      return res.send(buffer);
    } catch {}
  }

  return res.status(404).end();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "betandplay-content-hub-v2",
    mode: "on-demand",
    cache_ttl_ms: CACHE_TTL_MS
  });
});

app.get("/api/bonuses", async (_req,res) => {
  const key="sportsbook-bonuses";
  const hit=cached(key);
  if(hit){
    res.set("Cache-Control","public, max-age=60");
    return res.json({ok:true,cached:true,data:hit});
  }

  const urls=[
    UPSTREAM + "/bonuses/",
    UPSTREAM + "/bonuses"
  ];

  let lastError=null;
  for(const url of urls){
    try{
      const body=await fetchJson(url);
      setCached(key,body);
      res.set("Cache-Control","public, max-age=60");
      return res.json({ok:true,cached:false,data:body});
    }catch(error){
      lastError=error;
    }
  }

  res.status(lastError?.status || 502).json({
    ok:false,
    error:"bonuses_unavailable",
    status:lastError?.status || 502,
    details:typeof lastError?.body==="string" ? lastError.body.slice(0,300) : lastError?.body || null
  });
});

const KNOWN_PROMOTION_CONFIGS = {
  comboboost_2026_2: {
    bonusKey:"Comboboost 2026_2",
    type:"comboboost",
    names:[
      "تعزيز الكومبو الرياضي المتعدد",
      "Mega Kombi-Sport Boost",
      "Multi-Sport Combo Boost",
      "Super Combo Multi-Sport",
      "Kombi Boost Deluxe"
    ],
    localizedNames:[
      {locale:"AR",name:"تعزيز الكومبو الرياضي المتعدد"},
      {locale:"DE",name:"Mega Kombi-Sport Boost"},
      {locale:"DE-AT",name:"Mega Kombi-Sport Boost"},
      {locale:"DE-CH",name:"Mega Kombi-Sport Boost"},
      {locale:"EN",name:"Multi-Sport Combo Boost"},
      {locale:"EN-AR",name:"Multi-Sport Combo Boost"},
      {locale:"EN-AU",name:"Multi-Sport Combo Boost"},
      {locale:"EN-CA",name:"Multi-Sport Combo Boost"},
      {locale:"EN-IE",name:"Multi-Sport Combo Boost"},
      {locale:"EN-IN",name:"Multi-Sport Combo Boost"},
      {locale:"EN-NZ",name:"Multi-Sport Combo Boost"},
      {locale:"FI",name:"Multi-Sport Combo Boost"},
      {locale:"IT",name:"Super Combo Multi-Sport"},
      {locale:"NO",name:"Kombi Boost Deluxe"}
    ],
    showToUnauthorized:true,
    minOutcomeOdds:1.5,
    minBetOdds:7.6,
    ranges:[
      [5,1.05],[6,1.07],[7,1.10],[8,1.15],[9,1.20],[10,1.25],[11,1.30],[12,1.35],[13,1.40],[14,1.45],
      [15,1.50],[16,1.55],[17,1.60],[18,1.65],[19,1.70],[20,1.75],[21,1.80],[22,1.85],[23,1.90],[24,1.95],[25,2.00]
    ].map(([minCount,bonusOdds])=>({minCount,maxCount:minCount,bonusOdds})),
    usage:{
      sportTypes:"All sport types",
      sports:"All sports",
      categories:"All categories",
      tournaments:"All tournaments",
      events:"All events",
      countries:"All countries",
      eventStatus:"All statuses",
      markets:"All markets"
    },
    issuePeriod:{from:"2026-09-02T11:08:00",to:"2026-12-31T23:59:00"},
    validityPeriod:{from:"2026-09-02T11:08:00",to:"2026-12-31T23:59:00"},
    issueTrigger:"Player staying/entering in group",
    issueTo:"Exclude 1 group SB Bonus Abuser"
  }
};

function normalizePromoName(value=""){
  return String(value||"").toLowerCase().replace(/\([^)]*\)/g,"").replace(/[-–—_/]+/g," ").replace(/\s+/g," ").trim();
}

function knownPromotionConfig(type,name,details){
  if(type!=="comboboost") return null;
  const n=normalizePromoName(name);
  const candidates=Object.values(KNOWN_PROMOTION_CONFIGS).filter(x=>x.type===type);
  for(const cfg of candidates){
    if(cfg.names.some(alias=>n.includes(normalizePromoName(alias))||normalizePromoName(alias).includes(n))) return cfg;
  }
  const minOddsRaw=Number(details?.min_odds||0);
  const ranges=Array.isArray(details?.ranges)?details.ranges:[];
  const looksLikeKnown=minOddsRaw===7600 && ranges.some(r=>Number(r?.min_count)===5 && Number(r?.bonus_odds)===1050);
  return looksLikeKnown ? KNOWN_PROMOTION_CONFIGS.comboboost_2026_2 : null;
}

function apiOdds(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return null;
  return n>=1000 ? Number((n/1000).toFixed(3)) : n;
}

function normalizeComboboostBusiness(details,known){
  const apiRanges=(Array.isArray(details?.ranges)?details.ranges:[]).map(r=>({
    minCount:Number(r?.min_count||0)||null,
    maxCount:Number(r?.max_count||0)||null,
    bonusOdds:apiOdds(r?.bonus_odds)
  })).filter(r=>r.minCount||r.maxCount||r.bonusOdds);
  const eventConditions=Array.isArray(details?.event_conditions)?details.event_conditions:[];
  const allScope=eventConditions.length===0 || eventConditions.every(c=>!c?.sport&&!c?.category&&!c?.tournament&&!c?.event&&!c?.sport_type);
  return {
    bonusKey:known?.bonusKey || details?.bonus_key || details?.key || "",
    localizedNames:known?.localizedNames || [],
    visibleWithoutLogin:known?.showToUnauthorized ?? true,
    minOutcomeOdds:known?.minOutcomeOdds ?? details?.min_outcome_odds ?? details?.minimum_outcome_odds ?? null,
    minBetOdds:apiOdds(details?.min_odds) ?? known?.minBetOdds ?? null,
    ranges:apiRanges.length?apiRanges:(known?.ranges||[]),
    usage:known?.usage || {
      sportTypes:allScope?"All sport types":"Restricted",
      sports:allScope?"All sports":"Restricted",
      categories:allScope?"All categories":"Restricted",
      tournaments:allScope?"All tournaments":"Restricted",
      events:allScope?"All events":"Restricted",
      countries:Array.isArray(details?.country_codes)&&details.country_codes.length?details.country_codes.join(", "):"All countries",
      eventStatus:"All statuses",
      markets:"All markets"
    },
    issuePeriod:known?.issuePeriod || null,
    validityPeriod:{
      from:details?.issued?.valid_from || known?.validityPeriod?.from || null,
      to:details?.valid_to || details?.issued?.expired_at || known?.validityPeriod?.to || null
    },
    issueTrigger:known?.issueTrigger || details?.trigger_key || "",
    issueTo:known?.issueTo || "",
    api:{
      id:details?.id||"",
      status:details?.status||"",
      onlyVerified:details?.only_verified ?? null,
      triggerKey:details?.trigger_key||"",
      usesCount:details?.uses_count ?? null,
      countryCodes:Array.isArray(details?.country_codes)?details.country_codes:[],
      eventConditions
    }
  };
}

function normalizePromotionItem(type,item) {
  const details=item?.details && typeof item.details==="object" ? item.details : item || {};
  const id=details.uuid || details.id || item?.uuid || item?.id || "";
  const name=details.name || details.title || details.label || item?.name || item?.title || type.replace(/_/g," ");
  const status=details.status || item?.status || "";
  const expiresAt=details.expires_at || details.expired_at || details.valid_to || details.end_at || details.end_time || item?.expires_at || item?.valid_to || "";
  const startsAt=details.starts_at || details.valid_from || details.issued?.valid_from || details.start_at || details.start_time || item?.starts_at || item?.valid_from || "";
  const known=knownPromotionConfig(type,name,details);
  const business=type==="comboboost" ? normalizeComboboostBusiness(details,known) : null;
  return {type,id,name,status,startsAt,expiresAt,details,business,linkedConfig:Boolean(known)};
}

app.get("/api/promotions", async (_req,res) => {
  const key="public-promotions-v2";
  const hit=cached(key);
  if(hit) return res.json({ok:true,cached:true,...hit});

  const sources=[
    {type:"comboboost",url:UPSTREAM+"/bonuses/comboboosts?available=true&limit=50"},
    {type:"hunting",url:UPSTREAM+"/bonuses/huntings?available=true&limit=50"},
    {type:"lootbox",url:UPSTREAM+"/bonuses/lootboxes?available=true&limit=50"},
    {type:"daycombo",url:UPSTREAM+"/bonuses/day-combos"}
  ];

  const settled=await Promise.all(sources.map(async source=>{
    try{
      const body=await fetchJsonWithTimeout(source.url,5000);
      const rows=Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : Array.isArray(body?.bonuses) ? body.bonuses : [];
      return {type:source.type,ok:true,items:rows.map(item=>normalizePromotionItem(source.type,item)),meta:body?.snapshot?{snapshot:body.snapshot,isChanged:body?.is_changed}:undefined};
    }catch(error){
      return {type:source.type,ok:false,status:error?.status||502,items:[]};
    }
  }));

  const items=settled.flatMap(x=>x.items);
  const payload={items,sources:settled.map(({type,ok,status,meta})=>({type,ok,status,meta}))};
  setCached(key,payload);
  res.set("Cache-Control","public, max-age=60");
  res.json({ok:true,cached:false,...payload});
});

let editorialEventsWarmPromise=null;
async function warmEditorialEvents(){
  const hit=cached("editorial-events-v2");
  if(hit) return hit;
  if(editorialEventsWarmPromise) return editorialEventsWarmPromise;
  editorialEventsWarmPromise=getEditorialEvents(30)
    .then(events=>{
      cache.set("editorial-events-v2",{createdAt:Date.now(),value:events});
      return events;
    })
    .finally(()=>{editorialEventsWarmPromise=null});
  return editorialEventsWarmPromise;
}


function competitionCardSvg(key){
  const def=EDITORIAL_COMPETITIONS.find(x=>x.key===key);
  const label=def?.label||String(key||"Competition").replace(/_/g," ");
  const sport=def?.sport||"Sport";
  const themes={
    ucl:["#081B42","#2355D9","#7C4DFF","UCL"],
    europa:["#17120A","#E86A00","#FFB23F","UEL"],
    conference:["#112119","#28B46C","#74E5A1","UECL"],
    premier:["#18072B","#5B0B79","#C532E6","PL"],
    bundesliga:["#26080A","#DC0018","#FF5865","BL"],
    bundesliga2:["#122F51","#1565B1","#61A8EA","2B"],
    laliga:["#2A0808","#D8202A","#F05A64","LL"],
    seriea:["#071D35","#1465B5","#28C6EE","SA"],
    ligue1:["#071E25","#0B5460","#D8F000","L1"],
    facup:["#15213A","#214A92","#4E8FFF","FA"],
    carabao:["#102B1A","#1E7B47","#74D39A","EFL"],
    dfbpokal:["#2B1D08","#B8750C","#F1C052","DFB"],
    coppa_italia:["#15283C","#1976B8","#4BC0E8","CI"],
    copa_del_rey:["#341608","#BD6317","#F2A44A","CDR"],
    eredivisie:["#111F3B","#2056A4","#5B92DF","ERE"],
    primeira_liga:["#163728","#2F8B5E","#75C99D","LP"],
    saudi_pro:["#102E22","#16884F","#5DD38C","SPL"],
    nations:["#171C3D","#334DC4","#7287F0","UNL"],
    world_cup:["#2B1020","#8A254F","#D6588D","WC"],
    formula1:["#240808","#E10600","#FF5A52","F1"],
    nba:["#101A38","#17408B","#C9082A","NBA"],
    nhl:["#101820","#45525F","#98A3AD","NHL"],
    nfl:["#101A38","#013369","#D50A0A","NFL"],
    afl:["#102744","#1E5A98","#D54E4E","AFL"],
    nrl:["#0F2D22","#137A4C","#54C98A","NRL"],
    cricket:["#143024","#237548","#75C997","CRI"],
    tennis:["#173421","#3D8D58","#A4D65E","TEN"]
  };
  const [c1,c2,c3,mark]=themes[key]||["#0B3155","#167FD9","#4BA5F0",String(label).split(/\s+/).map(x=>x[0]).join("").slice(0,4).toUpperCase()];
  const xe=v=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="650" viewBox="0 0 1200 650">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c1}"/><stop offset=".58" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient>
    <radialGradient id="r" cx=".78" cy=".18" r=".72"><stop stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="650" rx="34" fill="url(#g)"/>
  <rect width="1200" height="650" rx="34" fill="url(#r)"/>
  <circle cx="1030" cy="95" r="280" fill="#fff" opacity=".08"/>
  <circle cx="1140" cy="520" r="245" fill="#07131F" opacity=".17"/>
  <path d="M0 505 C245 414 445 590 720 474 S1010 402 1200 470 V650 H0Z" fill="#061523" opacity=".30"/>
  <path d="M760 0 L1200 0 L1200 650 L1000 650 C900 500 868 326 760 0Z" fill="#061523" opacity=".14"/>
  <rect x="66" y="56" width="210" height="42" rx="21" fill="#fff" opacity=".13"/>
  <text x="171" y="84" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="2" fill="#fff">${xe(sport).toUpperCase()}</text>
  <text x="70" y="330" font-family="Arial,sans-serif" font-size="128" font-weight="900" fill="#fff">${xe(mark)}</text>
  <text x="72" y="414" font-family="Arial,sans-serif" font-size="46" font-weight="800" fill="#fff">${xe(label)}</text>
  <text x="72" y="458" font-family="Arial,sans-serif" font-size="20" font-weight="600" letter-spacing="1.5" fill="#fff" opacity=".72">CONTENT HUB · NEXT COMPETITION</text>
  <circle cx="1060" cy="360" r="98" fill="none" stroke="#fff" stroke-width="4" opacity=".18"/>
  <circle cx="1060" cy="360" r="60" fill="none" stroke="#fff" stroke-width="3" opacity=".15"/>
  <path d="M990 360 H1130 M1060 290 V430" stroke="#fff" stroke-width="3" opacity=".12"/>
  </svg>`;
}
app.get("/api/competition-card/:key.svg",(req,res)=>{
  const key=String(req.params.key||"").toLowerCase().replace(/[^a-z0-9_]/g,"");
  res.set("Content-Type","image/svg+xml; charset=utf-8");
  res.set("Cache-Control","public, max-age=86400");
  res.send(competitionCardSvg(key));
});

app.get("/api/big-events", async (_req, res) => {
  try {
    const hit=cached("editorial-events-v2");
    if(hit){
      res.set("Cache-Control","public, max-age=60");
      return res.json({ok:true,events:hit,cached:true});
    }
    const events = await warmEditorialEvents();
    res.set("Cache-Control","public, max-age=60");
    res.json({ok:true,events,cached:false});
  } catch (error) {
    res.status(error?.status || 502).json({ok:false,error:String(error?.message || error)});
  }
});

app.get("/api/match-markets/:id", async (req,res) => {
  try {
    const markets = await fetchMatchMarkets(req.params.id);
    const options = chooseBettingOptions(markets);
    const groups = normalizeMarketsForDrawer(markets);
    res.json({ok:true,options,groups});
  } catch (error) {
    res.status(error?.status || 502).json({ok:false,error:String(error?.message || error)});
  }
});


function editorialDateTime(e,language="EN"){
  const locale=language==="DE"?"de-DE":"en-GB";
  return new Intl.DateTimeFormat(locale,{timeZone:"Europe/Malta",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(e.startTime))+" CEST";
}
function copywriterMatchPost(e,variant=0,language="EN"){
  const main=(e.odds||[]).filter(o=>o?.value).slice(0,3);
  const extras=(e.bettingOptions||[]).filter(o=>o?.value).slice(0,6);
  const mainText=main.map(o=>"• "+o.label+" — "+o.value).join("\n");
  const extraText=extras.slice(0,3).map(o=>"• "+o.market+": "+o.label+" @ "+o.value).join("\n");
  const when=editorialDateTime(e,language);

  if(language==="DE"){
    if(variant%3===0){
      return "⚽ "+e.title+" steht als Nächstes in der "+e.competition+" an.\n\n⏰ "+when+
        (mainText?"\n\nHAUPTQUOTEN\n"+mainText:"")+
        "\n\n👉 Checke vor dem Anpfiff alle aktuellen Märkte bei Betandplay.";
    }
    if(variant%3===1){
      return "🎯 "+e.title+" — MEHR ALS NUR 1X2\n\n⏰ "+when+
        (extraText?"\n\nMÄRKTE IM BLICK\n"+extraText:"\n\nAktuell sind keine zusätzlichen Märkte verfügbar.")+
        "\n\n👉 Öffne das Spiel bei Betandplay und vergleiche die Optionen.";
    }
    return "🔥 "+e.competition+": "+e.title+"\n\nEin Spiel für Deine Watchlist. Die Hauptquoten geben den ersten Überblick, während alternative Märkte einen anderen Ansatz ermöglichen.\n\n"+
      (mainText?"HAUPTQUOTEN\n"+mainText+"\n\n":"")+
      (extraText?"ALTERNATIVE MÄRKTE\n"+extraText+"\n\n":"")+
      "⏰ "+when+"\n\n👉 Alle Quoten und Märkte bei Betandplay checken.";
  }

  if(variant%3===0){
    return "⚽ "+e.title+" is next up in the "+e.competition+".\n\n⏰ "+when+
      (mainText?"\n\nMAIN ODDS\n"+mainText:"")+
      "\n\n👉 Check the latest prices and full market on Betandplay before kick-off.";
  }
  if(variant%3===1){
    return "🎯 "+e.title+" — BEYOND THE 1X2\n\n⏰ "+when+
      (extraText?"\n\nMARKETS TO WATCH\n"+extraText:"\n\nNo additional markets are currently available.")+
      "\n\n👉 Open the match on Betandplay and compare the available angles.";
  }
  return "🔥 "+e.competition+": "+e.title+"\n\nOne for the watchlist. The main prices give the basic shape of the market, while the alternative markets offer a different way into the game.\n\n"+
    (mainText?"MAIN ODDS\n"+mainText+"\n\n":"")+
    (extraText?"ALTERNATIVE MARKETS\n"+extraText+"\n\n":"")+
    "⏰ "+when+"\n\n👉 Check every available market on Betandplay.";
}

function copywriterCompetitionPost(competition,items,variant=0,language="EN"){
  const games=items.slice(0,variant===2?6:4);
  const lines=games.map(e=>"• "+e.title+" · "+editorialDateTime(e,language));
  if(language==="DE"){
    const opens=[
      "🏆 "+competition+" ist zurück — und die nächsten Duelle stehen bereits fest.",
      "🔥 Der Blick richtet sich auf die "+competition+". Das sind die nächsten Spiele, die Du kennen solltest.",
      "👀 Was steht als Nächstes in der "+competition+" an? Hier kommt Dein schneller Überblick."
    ];
    return opens[variant%3]+"\n\n"+lines.join("\n")+"\n\n👉 Favoriten wählen, Quoten checken und die Action bei Betandplay verfolgen.";
  }
  const opens=[
    "🏆 "+competition+" is back on the agenda — and the next fixtures are already taking shape.",
    "🔥 All eyes on the "+competition+". These are the next games worth having on your radar.",
    "👀 What's next in the "+competition+"? Here's the quick fixture rundown."
  ];
  return opens[variant%3]+"\n\n"+lines.join("\n")+"\n\n👉 Pick your favourites, check the latest odds and follow the action on Betandplay.";
}
function comboMarketCandidates(e){
  const extras=(e.bettingOptions||[]).map(o=>({
    market:o.market||o.family||"Market",
    label:o.label,
    value:Number(o.value),
    family:o.family||marketFamily(o.market||"")
  }));
  const main=(e.odds||[]).map(o=>({
    market:"Match Result",
    label:o.label,
    value:Number(o.value),
    family:"result"
  }));
  return [...extras,...main].filter(o=>o.label&&Number.isFinite(o.value)&&o.value>1.01&&o.value<8);
}

function comboPickForEvent(e,variant=0,usedFamilies=new Map()){
  const profiles=[
    {min:1.35,max:2.05,families:["double_chance","draw_no_bet","goals_total","btts","team_total","result","handicap"]},
    {min:1.55,max:2.45,families:["goals_total","btts","handicap","team_total","draw_no_bet","result","corners"]},
    {min:1.80,max:3.40,families:["handicap","result","goals_total","btts","team_total","corners","cards"]}
  ];
  const p=profiles[variant%profiles.length];
  const target=(p.min+p.max)/2;
  const candidates=comboMarketCandidates(e)
    .filter(o=>o.value>=p.min&&o.value<=p.max)
    .map(o=>{
      const familyIndex=p.families.indexOf(o.family);
      const familyScore=familyIndex<0?20:familyIndex;
      const repetition=(usedFamilies.get(o.family)||0)*3;
      return {...o,score:familyScore+repetition+Math.abs(o.value-target)};
    })
    .sort((a,b)=>a.score-b.score);
  return candidates[0] || comboMarketCandidates(e)
    .filter(o=>o.value>=1.25&&o.value<=3.80)
    .sort((a,b)=>Math.abs(a.value-target)-Math.abs(b.value-target))[0] || null;
}

function buildComboVariant(items,variant=0,language="EN"){
  const unique=[...new Map(items.filter(e=>e?.id).map(e=>[String(e.id),e])).values()];
  const desired=Math.min(5,Math.max(3,unique.length));
  const start=variant%Math.max(1,unique.length);
  const rotated=[...unique.slice(start),...unique.slice(0,start)];
  const usedFamilies=new Map(),legs=[];
  for(const e of rotated){
    const pick=comboPickForEvent(e,variant,usedFamilies);
    if(!pick) continue;
    usedFamilies.set(pick.family,(usedFamilies.get(pick.family)||0)+1);
    legs.push({event:e,pick});
    if(legs.length>=desired) break;
  }
  if(legs.length<2) return null;
  const combined=legs.reduce((n,x)=>n*x.pick.value,1);
  const title=language==="DE"
    ? ["🔥 KOMBI DES TAGES","🎯 AUSGEWOGENE KOMBI","⚡ MUTIGERE KOMBI"][variant%3]
    : ["🔥 TODAY'S ACCA","🎯 BALANCED ACCA","⚡ BOLDER ACCA"][variant%3];
  const lines=legs.map(x=>"• "+x.event.title+" — "+x.pick.label+" @ "+x.pick.value.toFixed(2));
  const total=(Math.round(combined*100)/100).toFixed(2);
  if(language==="DE"){
    return title+"\n\n"+lines.join("\n")+"\n\n📊 Kombinierte Quote: "+total+"\n\nDie Varianten nutzen bewusst unterschiedliche Märkte und Risikoprofile. Quoten können sich ändern.\n\n👉 Vor Abgabe alle Preise bei Betandplay prüfen.";
  }
  return title+"\n\n"+lines.join("\n")+"\n\n📊 Combined odds: "+total+"\n\nEach option deliberately uses a different mix of markets and risk level. Prices can move.\n\n👉 Check every price on Betandplay before placing the bet.";
}

function numericOdd(value){
  const n=Number(value);
  return Number.isFinite(n) && n>1 ? n : null;
}

function comboCandidates(event){
  const extras=(event.bettingOptions||[])
    .map(o=>({
      title:event.title,
      market:o.market || "Market",
      label:o.label || "Selection",
      value:String(o.value||""),
      odd:numericOdd(o.value),
      family:o.family || marketFamily(o.market||"")
    }))
    .filter(o=>o.odd);

  const mains=(event.odds||[])
    .map(o=>({
      title:event.title,
      market:"Match Result",
      label:o.label || "Selection",
      value:String(o.value||""),
      odd:numericOdd(o.value),
      family:"result"
    }))
    .filter(o=>o.odd);

  return [...extras,...mains];
}

function isDrawLabel(label=""){
  return /(^|\b)(draw|x|tie)(\b|$)/i.test(String(label));
}

function selectComboPick(event,strategy,usedFamilies,legIndex){
  const all=comboCandidates(event);
  if(!all.length) return null;

  const preferences={
    balanced:["double_chance","goals_total","btts","draw_no_bet","team_total","result","handicap","corners"],
    goals:["goals_total","btts","team_total","corners","result","double_chance","handicap"],
    results:["draw_no_bet","double_chance","handicap","result","goals_total","btts","team_total"]
  }[strategy] || ["double_chance","goals_total","btts","result"];

  const sensible=all.filter(x=>x.odd>=1.15 && x.odd<=3.25);
  const pool=sensible.length?sensible:all.filter(x=>x.odd<=4.5);
  const resultPool=pool.filter(x=>x.family!=="result" || !isDrawLabel(x.label));

  for(const family of preferences){
    let rows=resultPool.filter(x=>x.family===family);
    if(!rows.length) continue;
    // Prefer medium prices and avoid repeating exactly the same market family across every leg.
    rows.sort((a,b)=>Math.abs(a.odd-1.7)-Math.abs(b.odd-1.7));
    if(usedFamilies.has(family) && rows.length>1) rows=rows.slice(1).concat(rows[0]);
    const pick=rows[legIndex%rows.length];
    if(pick) return pick;
  }

  return resultPool.sort((a,b)=>Math.abs(a.odd-1.7)-Math.abs(b.odd-1.7))[0] || pool[0] || null;
}

function buildComboLegs(items,variant=0){
  const strategies=["balanced","goals","results"];
  const strategy=strategies[variant%strategies.length];
  const rotated=[...items.slice(variant),...items.slice(0,variant)];
  const usedFamilies=new Set();
  const legs=[];
  const usedMatches=new Set();

  for(let i=0;i<rotated.length && legs.length<4;i++){
    const e=rotated[i];
    if(!e?.id || usedMatches.has(String(e.id))) continue;
    const pick=selectComboPick(e,strategy,usedFamilies,i);
    if(!pick) continue;
    usedMatches.add(String(e.id));
    usedFamilies.add(pick.family);
    legs.push({...pick,eventId:String(e.id)});
  }

  if(legs.length<3){
    for(const e of rotated){
      if(legs.length>=3) break;
      if(!e?.id || usedMatches.has(String(e.id))) continue;
      const pick=comboCandidates(e).sort((a,b)=>Math.abs(a.odd-1.7)-Math.abs(b.odd-1.7))[0];
      if(!pick) continue;
      usedMatches.add(String(e.id));
      legs.push({...pick,eventId:String(e.id)});
    }
  }
  return {strategy,legs};
}

function copywriterCombo(items,variant=0,language="EN",label="ACCA"){
  const {strategy,legs}=buildComboLegs(items,variant);
  if(!legs.length){
    return language==="DE"
      ? "Keine sinnvolle Kombi konnte mit den aktuell verfügbaren Märkten erstellt werden."
      : "No sensible ACCA could be built from the currently available markets.";
  }

  const combined=legs.reduce((n,x)=>n*(x.odd||1),1);
  const combinedText=combined>1 ? combined.toFixed(2) : "";
  const lines=legs.map(x=>"• "+x.title+" — "+x.market+": "+x.label+" @ "+x.value);
  const strategyLabel={
    balanced:language==="DE"?"Ausgewogene Kombi":"Balanced ACCA",
    goals:language==="DE"?"Tore & Spielverlauf":"Goals & game-flow ACCA",
    results:language==="DE"?"Ergebnisorientierte Kombi":"Result-focused ACCA"
  }[strategy];

  if(language==="DE"){
    const opens=[
      "🔥 KOMBI-IDEE DES TAGES",
      "⚽ TORE & MÄRKTE — KOMBI-IDEE",
      "🎯 ERGEBNIS-MIX FÜR DEN WETTSCHEIN"
    ];
    return opens[variant%3]+"\n"+strategyLabel+"\n\n"+lines.join("\n")+
      (combinedText?"\n\nKombinierte Quote: "+combinedText:"")+
      "\n\n👉 Prüfe alle Quoten noch einmal bei Betandplay, bevor Du die Kombi abgibst.";
  }

  const opens=[
    "🔥 TODAY'S ACCA IDEA",
    "⚽ GOALS & MARKETS ACCA",
    "🎯 RESULT-FOCUSED BETSLIP"
  ];
  return opens[variant%3]+"\n"+strategyLabel+"\n\n"+lines.join("\n")+
    (combinedText?"\n\nCombined odds: "+combinedText:"")+
    "\n\n👉 Check every price on Betandplay before placing the ACCA.";
}

function copywriterCompetitionInfo(competition,items,variant=0,language="EN"){
  const first=items[0], last=items[Math.min(items.length-1,5)];
  const fixtures=items.slice(0,5).map(e=>"• "+e.title+" · "+editorialDateTime(e,language)).join("\n");
  if(language==="DE"){
    const intro=["ℹ️ "+competition+" — DEIN SCHNELLER ÜBERBLICK","🏆 "+competition+" IM FOKUS","📅 WAS KOMMT ALS NÄCHSTES IN DER "+competition.toUpperCase()+"?"][variant%3];
    return intro+"\n\n"+fixtures+"\n\n"+(first&&last?"Von "+editorialDateTime(first,language)+" bis "+editorialDateTime(last,language)+" ist einiges geboten. ":"")+"👉 Alle Spiele und Märkte findest Du bei Betandplay.";
  }
  const intro=["ℹ️ "+competition+" — YOUR QUICK GUIDE","🏆 "+competition+" IN FOCUS","📅 WHAT'S NEXT IN THE "+competition.toUpperCase()+"?"][variant%3];
  return intro+"\n\n"+fixtures+"\n\n"+(first&&last?"From "+editorialDateTime(first,language)+" through "+editorialDateTime(last,language)+", there's plenty coming up. ":"")+"👉 Find every fixture and market on Betandplay.";
}

app.post("/api/content-builder", async (req,res) => {
  const mode=String(req.body?.mode||"match");
  const count=[1,3].includes(Number(req.body?.count))?Number(req.body.count):1;
  const language=req.body?.language==="DE"?"DE":"EN";
  const eventIds=Array.isArray(req.body?.eventIds)?req.body.eventIds.map(String):[];
  const competitionKeys=Array.isArray(req.body?.competitionKeys)?req.body.competitionKeys.map(String).filter(Boolean):[];
  try{
    const all=await getEditorialEvents(30);
    let selected=[];
    if(mode==="match"){
      selected=all.filter(e=>eventIds.includes(String(e.id))).slice(0,1);
    }else if(mode==="competition_post"||mode==="competition_info"){
      selected=all.filter(e=>competitionKeys.includes(String(e.competitionKey)));
    }else if(mode==="combo"){
      const byEvents=all.filter(e=>eventIds.includes(String(e.id)));
      const byCompetitions=competitionKeys.flatMap(key=>
        all.filter(e=>String(e.competitionKey)===String(key))
          .sort((a,b)=>Number(a.competitionPriority||999)-Number(b.competitionPriority||999)||new Date(a.startTime)-new Date(b.startTime))
          .slice(0,4)
      );
      const map=new Map([...byEvents,...byCompetitions].map(e=>[String(e.id),e]));
      selected=[...map.values()].slice(0,12);
    }else{
      return res.status(400).json({ok:false,error:"invalid_content_mode"});
    }
    selected.sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
    if(!selected.length) return res.status(400).json({ok:false,error:"nothing_selected"});

    if(mode==="combo"){
      await Promise.all(selected.slice(0,10).map(async e=>{
        try{
          const markets=await fetchMatchMarkets(e.id);
          e.bettingOptions=chooseBettingOptions(markets);
        }catch{}
      }));
    }

    const copies=[];
    for(let v=0;v<count;v++){
      if(mode==="match"){
        const e={...selected[0]};
        try{const markets=await fetchMatchMarkets(e.id);e.bettingOptions=chooseBettingOptions(markets)}catch{}
        copies.push({contentType:"Match post",copy:copywriterMatchPost(e,v,language)});
      }else if(mode==="competition_post"){
        const comp=competitionKeys[0];
        const items=selected.filter(e=>e.competitionKey===comp);
        copies.push({contentType:"Competition post",copy:copywriterCompetitionPost(items[0]?.competition||"Competition",items,v,language)});
      }else if(mode==="competition_info"){
        const comp=competitionKeys[0];
        const items=selected.filter(e=>e.competitionKey===comp);
        copies.push({contentType:"Competition information",copy:copywriterCompetitionInfo(items[0]?.competition||"Competition",items,v,language)});
      }else if(mode==="combo"){
        const labels=language==="DE"
          ? ["Ausgewogene Kombi","Tore & Märkte","Ergebnis-Mix"]
          : ["Balanced ACCA","Goals & Markets ACCA","Result-focused ACCA"];
        copies.push({contentType:labels[v%labels.length],copy:copywriterCombo(selected,v,language)});
      }
    }
    res.json({ok:true,variants:copies});
  }catch(error){
    res.status(error?.status||502).json({ok:false,error:String(error?.message||error)});
  }
});

app.post("/api/generate-variants", async (req,res) => {
  const matchId=String(req.body?.matchId || "");
  const prefs=contentPrefs(req.body || {});
  if(!matchId) return res.status(400).json({ok:false,error:"match_id_required"});

  try {
    const events=await getEditorialEvents(30);
    let event=findBigEventById(events,matchId);
    if(!event){
      try{
        const match=await fetchJson(UPSTREAM_V3+"/matches/"+encodeURIComponent(matchId));
        event=toBigEvent(match?.data || match);
      }catch(error){
        return res.status(error?.status===404?404:502).json({ok:false,error:"match_not_found"});
      }
    }

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
        copy:buildVariantPost(event,"short",prefs)
      },
      {
        ...event,
        contentType:"Aggressive Picks",
        variant:2,
        style:"aggressive",
        copy:buildVariantPost(event,"aggressive",prefs)
      },
      {
        ...event,
        contentType:"Context Preview",
        variant:3,
        style:"long",
        copy:buildVariantPost(event,"long",prefs)
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
    const url=new URL(UPSTREAM_V3+"/search");
    url.searchParams.set("q",String(req.query.q||""));
    const body=await fetchJson(url);
    const raw=responseRows(body);
    const now=Date.now();
    const matches = stripWomensEvents(raw)
      .filter(m => {
        const status=Number(m?.status);
        const t=new Date(m?.start_time||0).getTime();
        return status===1 || (Number.isFinite(t) && t>=now);
      })
      .sort((a,b)=>new Date(a?.start_time||0)-new Date(b?.start_time||0))
      .slice(0,20)
      .map(toBigEvent);

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
  res.set("Cache-Control","no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function runStartupDiagnostics(){
  try{
    const events=await warmEditorialEvents();
    const sample=events[0]||null;
    const imagePath=path.join(__dirname,"public","assets","competition-cards-user-v2.jpg");
    const summary={
      events:events.length,
      imageAsset:fs.existsSync(imagePath),
      sample:sample?{
        id:sample.id,
        title:sample.title,
        teamNames:sample.teamNames,
        odds:sample.odds,
        startTime:sample.startTime,
        competitionKey:sample.competitionKey
      }:null
    };

    if(events.length>=3){
      const comboEvents=events.slice(0,6).map(e=>({...e}));
      await Promise.all(comboEvents.map(async e=>{
        try{
          const markets=await fetchMatchMarkets(e.id);
          e.bettingOptions=chooseBettingOptions(markets);
        }catch{}
      }));
      const tests=[0,1,2].map(v=>copywriterCombo(comboEvents,v,"EN"));
      summary.comboVariants=tests.map(x=>({
        lines:String(x).split("\n").filter(Boolean).length,
        preview:String(x).split("\n").filter(Boolean).slice(0,3).join(" | ")
      }));
    }
    console.log("[startup-diagnostic] "+JSON.stringify(summary));
  }catch(error){
    console.error("[startup-diagnostic-error]",String(error?.message||error));
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log("Betandplay Content Hub V2 listening on port " + PORT);
  setTimeout(()=>runStartupDiagnostics(),80);
});
