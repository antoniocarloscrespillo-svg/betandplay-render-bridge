import express from "express";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM = "https://www.betandplay.com/sportsbook/api/v2";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const POST_SECRET = process.env.POST_SECRET || "";

const allowedMatchParams = new Set([
  "id",
  "type",
  "urn_id",
  "sort_by",
  "sport_key",
  "sport_id",
  "sport_type",
  "category_id",
  "tournament_id",
  "match_status",
  "bettable",
  "favourite",
  "start_from",
  "start_to",
  "max_per_sport",
  "has_video",
  "page",
  "limit"
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
  for (const [key, value] of searchParams.entries()) {
    url.searchParams.append(key, value);
  }

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
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      url: url.toString(),
      body
    };
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
      upstream_body:
        typeof result.body === "string" ? result.body.slice(0, 1000) : result.body
    });
  }
  return res.json(normalizeOdds ? normalizeOddsPayload(result.body) : result.body);
}

function requirePostSecret(req, res, next) {
  if (!POST_SECRET) {
    return res.status(503).json({ ok: false, error: "post_secret_not_configured" });
  }
  const supplied = req.get("x-bridge-key") || "";
  if (supplied !== POST_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

async function telegramApi(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("telegram_bot_token_not_configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const err = new Error(data?.description || `telegram_http_${response.status}`);
      err.status = response.status;
      err.telegram = data;
      throw err;
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

app.get("/", (_req, res) => {
  res.json({
    service: "betandplay-render-bridge",
    read_only_sportsbook: true,
    endpoints: [
      "/health",
      "/matches",
      "/matches/:id/markets",
      "/telegram/status",
      "/telegram/send"
    ]
  });
});

app.get("/health", async (_req, res) => {
  try {
    const params = new URLSearchParams({ limit: "1" });
    const result = await fetchUpstream("/matches", params);

    res.status(result.ok ? 200 : 503).json({
      ok: result.ok,
      service: "betandplay-render-bridge",
      upstream: "Betandplay Sportsbook",
      upstream_status: result.status,
      upstream_content_type: result.contentType,
      telegram_configured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && POST_SECRET),
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "betandplay-render-bridge",
      error: error?.name === "AbortError" ? "upstream_timeout" : "upstream_error",
      message: String(error?.message || error)
    });
  }
});

app.get("/matches", async (req, res) => {
  try {
    const params = copyAllowedParams(req.query, allowedMatchParams);
    const result = await fetchUpstream("/matches", params);
    return sendUpstream(res, result, false);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error?.name === "AbortError" ? "upstream_timeout" : "upstream_error",
      message: String(error?.message || error)
    });
  }
});

app.get("/matches/:id/markets", async (req, res) => {
  const id = String(req.params.id || "");
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ ok: false, error: "invalid_match_id" });
  }

  try {
    const params = copyAllowedParams(req.query, allowedMarketParams);
    const result = await fetchUpstream("/matches/" + id + "/markets", params);
    return sendUpstream(res, result, true);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error?.name === "AbortError" ? "upstream_timeout" : "upstream_error",
      message: String(error?.message || error)
    });
  }
});

app.get("/telegram/status", (_req, res) => {
  res.json({
    ok: true,
    bot_token_configured: Boolean(TELEGRAM_BOT_TOKEN),
    chat_id_configured: Boolean(TELEGRAM_CHAT_ID),
    post_secret_configured: Boolean(POST_SECRET)
  });
});

app.post("/telegram/send", requirePostSecret, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const chatId = req.body?.chat_id || TELEGRAM_CHAT_ID;

  if (!text) {
    return res.status(400).json({ ok: false, error: "text_required" });
  }
  if (text.length > 4096) {
    return res.status(400).json({ ok: false, error: "text_too_long" });
  }
  if (!chatId) {
    return res.status(503).json({ ok: false, error: "telegram_chat_id_not_configured" });
  }

  try {
    const result = await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    });

    return res.json({
      ok: true,
      message_id: result.message_id,
      chat_id: result.chat?.id,
      sent_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(error?.status || 502).json({
      ok: false,
      error: "telegram_send_failed",
      message: String(error?.message || error)
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Betandplay bridge listening on port ${PORT}`);
});
