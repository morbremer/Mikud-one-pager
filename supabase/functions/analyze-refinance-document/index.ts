import { GoogleGenAI } from "npm:@google/genai@^2.0.0";

// Portable refinance analysis core. The hosting platform only supplies a
// standard Deno HTTP runtime and the GEMINI_API_KEY environment variable.
const GEMINI_MODEL = 'gemini-3.5-flash';
// Caps generation so a run-away response can't stall the request. Extraction of
// a 12-track statement fits comfortably; before this cap a single call was
// observed still streaming after 5 minutes.
const MAX_OUTPUT_TOKENS = 16384;
// No per-call deadline existed at all, so one stuck Gemini call held the whole
// analysis open until the caller gave up.
const GEMINI_CALL_TIMEOUT_MS = 90_000;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Resolve the secret once at module scope without ever exposing it to the browser.
const directGeminiApiKey = Deno.env.get('GEMINI_API_KEY');
const denoEnvironment = Deno.env.toObject();
const normalizedGeminiEntry = Object.entries(denoEnvironment).find(
  ([key, value]) => key.trim() === 'GEMINI_API_KEY' && Boolean(value?.trim()),
);
const nodeProcess = Reflect.get(globalThis, 'process');
const processGeminiApiKey = nodeProcess?.env?.GEMINI_API_KEY;
const GEMINI_API_KEY = (
  directGeminiApiKey?.trim()
  || normalizedGeminiEntry?.[1]?.trim()
  || (typeof processGeminiApiKey === 'string' ? processGeminiApiKey.trim() : '')
);
const GEMINI_SECRET_STATUS = GEMINI_API_KEY
  ? 'configured'
  : Deno.env.has('GEMINI_API_KEY')
    ? 'empty'
    : 'missing-from-function-environment';

function jsonResponse(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers || {}) },
  });
}

function validateDocumentUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid document URL');
  }

  // Supabase injects SUPABASE_URL into every Edge Function. Using it here
  // keeps the signed-URL allowlist tied to the project that created the URL,
  // rather than the legacy Base44-era project.
  const configuredOrigin = Deno.env.get('REFINANCE_STORAGE_ORIGIN') || Deno.env.get('SUPABASE_URL');
  if (!configuredOrigin) throw new Error('Supabase storage origin is not configured');
  const allowedOrigin = new URL(configuredOrigin).origin;
  const expectedPath = '/storage/v1/object/sign/documents/';

  if (url.protocol !== 'https:' || url.origin !== allowedOrigin || !url.pathname.startsWith(expectedPath)) {
    throw new Error('Document URL is not from the configured Supabase documents bucket');
  }

  return url.toString();
}

// Rejects if `promise` hasn't settled within `ms`. The underlying request keeps
// running — the SDK exposes no abort hook — but the caller stops waiting on it.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── base64 helper — safe for large files (avoids call-stack blowup on big arrays) ──
function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    return btoa(binary);
}

const MIME_MAP = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const guessMimeType = (url) => {
    // Strip the query string BEFORE splitting on '.' — Supabase signed URLs embed
    // a JWT (header.payload.signature) in the query string, and JWTs contain dots
    // themselves. Splitting on '.' first (the original order) grabs a fragment of
    // the token instead of the real file extension. Bug found via live smoke test
    // (2026-07-29) on the sibling preScanDocuments function; fixed here too since
    // this file has the identical pattern.
    const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() || 'pdf';
    return MIME_MAP[ext] || 'application/octet-stream';
};

// Raised when the model answers with something that isn't the JSON we asked
// for. Kept distinct from Gemini transport/capacity errors so the top-level
// handler can't mistake an internal contract failure for an unreadable upload.
class GeminiContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeminiContractError';
  }
}

// Structured output must be requested via `responseMimeType` + `responseJsonSchema`
// on GenerateContentConfig. An earlier revision set a `responseFormat` object
// (the shape belonging to the separate `interactions.create` API); that key
// isn't part of GenerateContentConfig, so the SDK dropped it silently, JSON mode
// was never enabled, and every extraction came back as prose that blew up in
// JSON.parse. `responseJsonSchema` — not `responseSchema` — is the correct field
// here: these schemas use standard JSON Schema nullable type arrays
// (`type: ["string", "null"]`), which the OpenAPI-subset `responseSchema` rejects.
async function invokeGemini({ model, prompt, files = [], schema = null }) {
  if (!GEMINI_API_KEY) {
    throw new Error(`GEMINI_API_KEY is not configured (${GEMINI_SECRET_STATUS})`);
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const parts = [{ text: prompt }];
  for (const { mimeType, data } of files) {
    parts.push({ inlineData: { mimeType, data } });
  }

  const config = { maxOutputTokens: MAX_OUTPUT_TOKENS };
  if (schema) {
    config.responseMimeType = 'application/json';
    config.responseJsonSchema = schema;
  }

  const result = await withTimeout(
    ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config,
    }),
    GEMINI_CALL_TIMEOUT_MS,
    `Gemini call exceeded ${Math.round(GEMINI_CALL_TIMEOUT_MS / 1000)}s`,
  );
  const text = result.text || '';
  if (!schema) return text;

  try {
    return JSON.parse(text);
  } catch {
    // Surface what the model actually said. A bare SyntaxError here reads as
    // "…is not valid JSON", which the old top-level catch matched on the
    // substring "JSON" and reported to the borrower as an unreadable document.
    throw new GeminiContractError(
      `Model did not return JSON (got ${text.length} chars): ${text.slice(0, 200)}`,
    );
  }
}

function getGeminiErrorDetails(error) {
  const message = String(error?.message || error || '');

  // A contract violation is deterministic, and its message embeds raw model
  // output — which could contain any words at all, including the ones the
  // transient heuristic below looks for. Classify it before that can happen.
  if (error instanceof GeminiContractError) {
    return { message, status: 0, isTransient: false, isContractError: true };
  }

  const numericCandidates = [
    error?.status,
    error?.code,
    error?.response?.status,
  ];
  let status = numericCandidates
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value >= 400 && value <= 599);

  if (!status) {
    const codeMatch = message.match(/(?:"code"\s*:\s*|\bHTTP\s+)(\d{3})/i);
    status = codeMatch ? Number(codeMatch[1]) : 0;
  }

  const isTransient = [408, 429, 500, 502, 503, 504].includes(status)
    || /\bUNAVAILABLE\b|high demand|overloaded|temporarily unavailable/i.test(message);

  return { message, status, isTransient, isContractError: false };
}

async function invokeGeminiWithRetry(options) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await invokeGemini(options);
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      const details = getGeminiErrorDetails(error);
      // Only genuinely transient failures are worth a second attempt. Retrying
      // deterministic ones (bad config, contract violations) just doubled the
      // load: one submit already fans out to several concurrent calls, each
      // carrying the full document, so blind retry can tip a rate limit on its
      // own and still cannot succeed.
      if (!details.isTransient) {
        console.warn(`Gemini attempt ${attempt} failed permanently: ${details.message}`);
        break;
      }
      const retryDelayMs = 3000 + Math.floor(Math.random() * 1500);
      console.warn(
        `Gemini attempt ${attempt} failed; retrying once in ${retryDelayMs}ms: ${details.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // This public quick-check flow intentionally has no application-auth gate.

    const { file_url, transaction_type, external_debts_input } = await req.json();

    if (!file_url) {
      return jsonResponse({ error: 'Missing file_url' }, { status: 400 });
    }

    // The browser uploads to Supabase and sends a one-hour signed URL. The
    // analyzer needs no Supabase service-role credential and retains no copy.
    const validatedFileUrl = validateDocumentUrl(file_url);
    const fileResponse = await fetch(validatedFileUrl);
    if (!fileResponse.ok) {
      return jsonResponse({
        success: false,
        error: `Failed to download file: HTTP ${fileResponse.status}`,
      }, { status: 200 });
    }
    const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
    const documentFile = {
      mimeType: fileResponse.headers.get('content-type')?.split(';')[0] || guessMimeType(file_url),
      data: bytesToBase64(fileBytes),
    };

    console.log(`📋 Transaction Type: ${transaction_type}`);

    // Log only the non-sensitive file type; never log the signed URL.
    const urlLower = file_url.toLowerCase().split('?')[0];
    const fileExt = urlLower.split('.').pop() || 'unknown';
    console.log(`📁 File type: ${fileExt}`);
    const today = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: UNIVERSAL FINANCIAL EXTRACTION (bank-agnostic)
    // One powerful prompt that works for ANY Israeli bank payoff statement
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const UNIVERSAL_EXTRACTION_PROMPT = `You are a senior Israeli mortgage financial analyst. Extract ALL data from this mortgage payoff statement (דף יתרת סילוק / אישור יתרה).

DOCUMENT TYPE: This is an Israeli bank mortgage payoff statement. It may come from ANY bank (Hapoalim, Leumi, Discount, Mizrahi, Jerusalem, International, etc.) in ANY format — tables, columns, rows, multi-page. Your job is to extract numbers accurately regardless of format.

TODAY: ${today}

═══ WHAT TO EXTRACT ═══

1. STATEMENT DATE: Look for: תאריך הדוח / תאריך היתרה / ליום / נכון ל / תאריך. Return in DD/MM/YYYY format.

2. BANK NAME: Identify the bank from logo/header/account number prefix.

3. FOR EACH LOAN TRACK (מסלול / הלוואה / רכיב):
   The document may have 1-10 tracks in various layouts. Find ALL of them.

   a) REMAINING BALANCE (יתרת קרן / יתרה לסילוק / יתרת הלוואה):
      - This is the CURRENT outstanding principal, NOT the original loan amount
      - Usually between ₪20,000 and ₪2,000,000 per track
      - Hebrew labels: יתרת קרן, יתרה לסילוק, יתרת ההלוואה, קרן שנותרה
      - DO NOT use: סכום ההלוואה המקורי / סכום מקורי (original amount — ignore this)

   b) INTEREST RATE (שיעור ריבית / ריבית):
      - The CURRENT nominal interest rate in percent (e.g., 4.5, 2.8, 5.1)
      - Labels: שיעור ריבית נומינלי, ריבית נוכחית, ריבית שנתית
      - If it shows "P-0.6%" → the rate IS the prime rate MINUS 0.6 (e.g. prime=6.0, so rate=5.4)
      - If it shows "P+1.5%" → rate = prime + 1.5
      - Prime rate (פריים) in Israel as of 2025-2026 = approximately 6.0%
      - ALWAYS return the actual numeric rate, not the spread formula

   c) REMAINING MONTHS (חודשים שנותרו):
      - Calculate from TODAY (${today}) to the end date
      - End date labels: מועד סיום, מועד פירעון, תאריך סילוק, מועד תשלום אחרון, תוקף ההלוואה
      - Example: end date 04/2053, today 03/2026 → 325 months
      - If shown in years, multiply by 12

   d) TRACK TYPE (סוג המסלול):
      Classify as one of these 5 types based on the rate basis field (בסיס ריבית / סוג ריבית / מסלול):
      - "פריים" → if rate basis contains P / פריים / Prime
      - "קבועה צמודה" → Fixed rate + CPI-linked (מדד / הצמדה / H+)
      - "קבועה לא צמודה" → Fixed rate, NOT linked to CPI (% only, no P/H/V)
      - "משתנה צמודה" → Variable rate + CPI-linked
      - "משתנה לא צמודה" → Variable rate, NOT CPI-linked (V+ / אג"ח / ממשלתי)

   e) IS_INDEX_LINKED (צמוד מדד):
      - TRUE only if explicitly CPI-linked (מדד המחירים לצרכן / הצמדה למדד / H+)
      - FALSE for: Prime (P), bond-based variable (V+), fixed unlinked
      - V+ tracks (variable based on government bonds) are NOT CPI-linked → false

   f) RATE BASIS (בסיס ריבית): Exact text from document, e.g. "P-0.60%", "H+3.45%", "V+3.00%", "4.90%"

   g) PAYMENT METHOD (שיטת פירעון): שפיצר / קרן שווה / בלון / ריבית בלבד / bullet

   h) PREPAYMENT FEE (עמלת פירעון מוקדם):
      - The actual exit penalty for early repayment per track
      - Labels: עמלת פירעון מוקדם, דמי פירעון מוקדם, קנס פירעון
      - DO NOT confuse with: הפרשי הצמדה, ריבית שנצברה, הצמדה שנצברה (those are accruals, not fees)
      - Prime tracks: usually ₪0
      - Fixed/linked tracks: can be ₪0 to ₪50,000
      - Small amounts like ₪343, ₪500 are valid — do NOT round to 0

4. TOTAL MONTHLY PAYMENT: Sum of all track payments, or from a summary row. Labels: תשלום חודשי כולל, החזר חודשי.

5. TOTAL EARLY REPAYMENT FEE: Sum of all track fees, or from a "סה"כ עמלת פירעון מוקדם" row.

6. ARREARS DEBT (פיגורים): Any overdue/arrears amount if shown. Labels: חוב בפיגור, יתרת פיגורים, חוב עבר.

7. PROPERTY VALUE: If mentioned in the document. Labels: שווי נכס, ערך הנכס.

8. BORROWERS: Names, ID numbers (ת.ז - 9 digits), ages if shown.

═══ CRITICAL RULES ═══
- Extract ALL tracks — multi-page documents may have 4-12 tracks spread across pages
- Sum track balances for total. If you see a "סה"כ" summary row, verify it matches your sum
- Never invent numbers — if unclear, return null for that field
- For multi-column layouts: each column = one track
- For multi-row layouts: each row group = one track

Return structured data as specified in the JSON schema.`;

    // ━━━ STEP 0: Fetch market rates in background (no file needed) ━━━
    // Real Bank of Israel data, not an AI guess. Two calls, no auth, no scraping:
    //   1. GetInterest — the official BOI base rate. Prime = base + 1.5%, the
    //      same regulated formula every bank uses, so this is exact, not modeled.
    //   2. The BOI series-database SDMX API (edge.boi.org.il — a different host
    //      from boi.org.il, not behind the Radware bot-check that blocks the
    //      documentation site) for the published average new-mortgage rate on
    //      the two fixed tracks (BIR_MRTG_99 dataflow, series below).
    // Variable-track rates (linked/unlinked) have no reliable single published
    // aggregate — BOI only reports them split by reset-period bucket, and none
    // of those buckets had a current data point when checked. Rather than guess,
    // those two stay on the same static constants the rest of the app already
    // uses (FALLBACK_RATES below) — no search, no AI, ever, for any of the five.
    //
    // These barely move day to day, so this isn't refetched per analysis: a
    // small boi_rate_cache table (see migration) holds the last fetch, and only
    // the request that finds it >24h stale calls BOI at all — everyone else
    // (and every other refinance check that day) reads the cached row instead.
    // The cache itself is optional, not required: this function's only hard
    // dependency stays GEMINI_API_KEY, so if SUPABASE_URL/SERVICE_ROLE_KEY are
    // ever missing this just silently falls back to fetching BOI directly every
    // time, same as before caching existed.
    const BOI_FIXED_UNLINKED_SERIES = 'BNK_99034_LR_BIR_MRTG_467';  // ריבית קבועה לא צמודה, חדש, סך מערכת בנקאית
    const BOI_FIXED_LINKED_SERIES = 'BNK_99034_LR_BIR_MRTG_1492';   // ריבית קבועה צמודה מדד, חדש, סך מערכת בנקאית
    const RATE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

    const supabaseRestUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cacheHeaders = supabaseRestUrl && supabaseServiceKey ? {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    } : null;

    async function readRateCache() {
      if (!cacheHeaders) return null;
      try {
        const res = await fetch(
          `${supabaseRestUrl}/rest/v1/boi_rate_cache?id=eq.1&select=prime,fixed_unlinked,fixed_linked,fetched_at`,
          { headers: cacheHeaders, signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) return null;
        const [row] = await res.json();
        if (!row) return null;
        const ageMs = Date.now() - new Date(row.fetched_at).getTime();
        if (ageMs > RATE_CACHE_MAX_AGE_MS) return null;
        return { prime: Number(row.prime), fixed_unlinked: Number(row.fixed_unlinked), fixed_linked: Number(row.fixed_linked) };
      } catch (e) {
        console.warn(`Rate cache read failed (continuing without it): ${e.message}`);
        return null;
      }
    }

    async function writeRateCache(rates) {
      if (!cacheHeaders) return;
      try {
        await fetch(`${supabaseRestUrl}/rest/v1/boi_rate_cache`, {
          method: 'POST',
          headers: { ...cacheHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ id: 1, ...rates, fetched_at: new Date().toISOString() }),
          signal: AbortSignal.timeout(5000),
        });
      } catch (e) {
        console.warn(`Rate cache write failed (rates still returned, just not cached): ${e.message}`);
      }
    }

    async function fetchLiveRatesFromBOI() {
      const [primeRes, mrtgRes] = await Promise.all([
        fetch('https://www.boi.org.il/PublicApi/GetInterest', { signal: AbortSignal.timeout(8000) }),
        fetch(
          `https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR_MRTG_99/1.0/` +
          `?c%5BSERIES_CODE%5D=${BOI_FIXED_UNLINKED_SERIES},${BOI_FIXED_LINKED_SERIES}` +
          `&format=sdmx-json&lastNObservations=1&locale=he`,
          { signal: AbortSignal.timeout(8000) },
        ),
      ]);
      if (!primeRes.ok) throw new Error(`BOI GetInterest returned ${primeRes.status}`);
      if (!mrtgRes.ok) throw new Error(`BOI series API returned ${mrtgRes.status}`);

      const primeData = await primeRes.json();
      const boiBaseRate = Number(primeData.currentInterest);
      if (!Number.isFinite(boiBaseRate)) throw new Error('BOI GetInterest returned an invalid rate');
      const prime = boiBaseRate + 1.5; // regulated formula: prime = BOI base rate + 1.5%, always

      const mrtgData = await mrtgRes.json();
      const seriesNames = mrtgData?.data?.structure?.dimensions?.series?.[0]?.values || [];
      const seriesData = mrtgData?.data?.dataSets?.[0]?.series || {};
      const rateBySeriesCode = {};
      for (const [key, val] of Object.entries(seriesData)) {
        const seriesIndex = Number(key.split(':')[0]);
        const code = seriesNames[seriesIndex]?.id;
        const latestObservation = Object.values(val.observations || {})[0];
        if (code && Array.isArray(latestObservation)) rateBySeriesCode[code] = Number(latestObservation[0]);
      }
      const fixed_unlinked = rateBySeriesCode[BOI_FIXED_UNLINKED_SERIES];
      const fixed_linked = rateBySeriesCode[BOI_FIXED_LINKED_SERIES];
      if (!Number.isFinite(fixed_unlinked) || !Number.isFinite(fixed_linked)) {
        throw new Error('BOI series API did not return both fixed-rate series');
      }

      return { prime, fixed_unlinked, fixed_linked };
    }

    let ratesError = null;
    const ratesPromise = (async () => {
      const cached = await readRateCache();
      if (cached) return cached;

      const fresh = await fetchLiveRatesFromBOI();
      await writeRateCache(fresh);
      return fresh;
    })().catch((error) => {
      ratesError = error;
      return null;
    });

    // ━━━ PARALLEL: Universal extraction + identity (simultaneously) ━━━
    console.log(`🔬 Running universal parallel extraction...`);

    const EXTRACTION_SCHEMA = {
      type: "object",
      properties: {
        bank_name: { type: ["string", "null"] },
        statement_date: { type: ["string", "null"] },
        is_full_payoff_statement: { type: "boolean" },
        remaining_balance: { type: "number", description: "Sum of all track balances" },
        monthly_payment: { type: "number", description: "Total monthly payment" },
        remaining_months: { type: ["number", "null"] },
        average_interest_rate: { type: ["number", "null"] },
        total_early_repayment_fee: { type: ["number", "null"] },
        arrears_debt: { type: ["number", "null"] },
        estimated_property_value: { type: ["number", "null"] },
        tracks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              track_type: { type: "string" },
              remaining_balance: { type: "number" },
              interest_rate: { type: "number" },
              remaining_months: { type: "number" },
              is_index_linked: { type: "boolean" },
              rate_basis: { type: ["string", "null"] },
              payment_method: { type: ["string", "null"] },
              prepayment_fee: { type: ["number", "null"] },
              monthly_payment: { type: ["number", "null"] }
            }
          }
        }
      }
    };

    const IDENTITY_SCHEMA = {
      type: "object",
      properties: {
        statement_date: { type: ["string", "null"] },
        borrowers_found: {
          type: "array",
          items: {
            type: "object",
            properties: {
              full_name: { type: "string" },
              first_name: { type: "string" },
              last_name: { type: "string" },
              id_number: { type: ["string", "null"] },
              age: { type: ["number", "null"] }
            }
          }
        }
      }
    };

    const IDENTITY_PROMPT = `Extract borrower names, ID numbers (ת.ז - must be 9 digits), ages from this Israeli mortgage document.
Also extract the statement date (תאריך הדוח / תאריך היתרה / ליום) in DD/MM/YYYY format.
Only extract what you can clearly read. Return null if unclear.`;

    // PDFs and images use the same Gemini multimodal path. Each call retries
    // Gemini once on failure; no secondary provider is configured.
    const runExtractionWithRetry = async () => {
      const [extr, ident] = await Promise.all([
        invokeGeminiWithRetry({
          model: GEMINI_MODEL,
          prompt: UNIVERSAL_EXTRACTION_PROMPT,
          files: [documentFile],
          schema: EXTRACTION_SCHEMA,
        }),
        invokeGeminiWithRetry({
          model: GEMINI_MODEL,
          prompt: IDENTITY_PROMPT,
          files: [documentFile],
          schema: IDENTITY_SCHEMA,
        }),
      ]);

      // Structured output is only actually in force if the SDK accepted our
      // schema fields. Assert the shape rather than trusting the config: a
      // silently-ignored config key is exactly how this broke before, and
      // downstream code indexes into these objects assuming they're populated.
      if (!extr || typeof extr !== 'object' || Array.isArray(extr)) {
        throw new GeminiContractError('Extraction did not return a JSON object');
      }
      if (!Array.isArray(extr.tracks) && typeof extr.remaining_balance !== 'number') {
        throw new GeminiContractError(
          `Extraction matched no part of the schema (keys: ${Object.keys(extr).join(', ') || 'none'})`,
        );
      }

      return { extractionResult: extr, identityResult: ident && typeof ident === 'object' ? ident : {} };
    };

    const { extractionResult, identityResult } = await runExtractionWithRetry();

    // Await the rates (already running in background since before file extraction)
    let ratesResultRaw = null;
    try {
      ratesResultRaw = await ratesPromise;
      if (ratesError) throw ratesError;
      console.log(`✅ Live BOI rates fetched: prime=${ratesResultRaw?.prime}% fixed_unlinked=${ratesResultRaw?.fixed_unlinked}% fixed_linked=${ratesResultRaw?.fixed_linked}%`);
    } catch(e) {
      console.warn(`⚠️ Live BOI rates fetch failed, using fallback: ${e.message}`);
    }

    console.log(`✅ Extraction done: ${extractionResult.tracks?.length || 0} tracks | Balance: ₪${extractionResult.remaining_balance?.toLocaleString()}`);

    // ━━━ FALLBACK: If initial extraction returned nothing, retry with Gemini ━━━
    const gotNothing = !extractionResult.remaining_balance && (!extractionResult.tracks || extractionResult.tracks.length === 0);
    if (gotNothing) {
      console.log(`⚠️ Extraction returned nothing — retrying with ${GEMINI_MODEL}...`);
      try {
        const retryResult = await invokeGeminiWithRetry({
          model: GEMINI_MODEL,
          prompt: UNIVERSAL_EXTRACTION_PROMPT,
          files: [documentFile],
          schema: EXTRACTION_SCHEMA
        });
        if (retryResult.remaining_balance > 0 || (retryResult.tracks && retryResult.tracks.length > 0)) {
          Object.assign(extractionResult, retryResult);
          console.log(`✅ Gemini fallback succeeded: ${retryResult.tracks?.length || 0} tracks | Balance: ₪${retryResult.remaining_balance?.toLocaleString()}`);
        } else {
          console.log(`❌ Gemini fallback also returned nothing`);
        }
      } catch(e) {
        console.warn(`Gemini fallback error: ${e.message}`);
      }
    }

    // ━━━ STATEMENT DATE ━━━
    const statementDate = identityResult.statement_date || extractionResult.statement_date || null;
    let statementDateWarning = null;
    if (statementDate) {
      try {
        const parts = statementDate.split('/');
        const dt = new Date(+parts[2], +parts[1]-1, +parts[0]);
        const daysDiff = Math.round((new Date() - dt) / (1000*60*60*24));
        if (daysDiff > 90) {
          statementDateWarning = `דף יתרת הסילוק מתאריך ${statementDate} — לפני ${daysDiff} ימים. הבנק ידרוש יתרה עדכנית (עד 90 יום). יש לבקש יתרה חדשה.`;
        }
      } catch(e) {}
    }

    // ━━━ BORROWERS ━━━
    const finalBorrowers = (identityResult.borrowers_found || []).map(b => ({
      first_name: b.first_name,
      last_name: b.last_name,
      id_number: b.id_number,
      age: b.age
    }));
    extractionResult.borrower_1 = finalBorrowers[0] || null;
    extractionResult.borrower_2 = finalBorrowers[1] || null;

    // ━━━ MARKET RATES ━━━
    // Deterministic. Prime + the two fixed-track rates come straight from Bank
    // of Israel (see ratesPromise above) — a real published number, not a model
    // guess, so no clamping/squeezing toward a hardcoded anchor is needed here,
    // just a wide sanity check against an API outage or malformed response.
    // Variable-track rates have no reliable single published aggregate (BOI only
    // reports them split by reset-period bucket), so they always use the static
    // constants below — never fetched, never guessed, never searched.
    const FALLBACK_RATES = { prime: 5.0, fixed_linked: 3.2, fixed_unlinked: 4.7, variable_linked: 3.1, variable_unlinked: 4.6 };
    const isSaneRate = (rate, min, max) => Number.isFinite(rate) && rate >= min && rate <= max;
    const liveRatesUsable = Boolean(ratesResultRaw)
      && isSaneRate(ratesResultRaw.prime, 2, 10)
      && isSaneRate(ratesResultRaw.fixed_unlinked, 2, 10)
      && isSaneRate(ratesResultRaw.fixed_linked, 0, 8);
    const CURRENT_MARKET_RATES = {
      prime: liveRatesUsable ? ratesResultRaw.prime : FALLBACK_RATES.prime,
      fixed_unlinked: liveRatesUsable ? ratesResultRaw.fixed_unlinked : FALLBACK_RATES.fixed_unlinked,
      fixed_linked: liveRatesUsable ? ratesResultRaw.fixed_linked : FALLBACK_RATES.fixed_linked,
      variable_linked: FALLBACK_RATES.variable_linked,
      variable_unlinked: FALLBACK_RATES.variable_unlinked,
    };
    if (!liveRatesUsable) console.warn(`⚠️ Live BOI rates unavailable/out of range (prime=${ratesResultRaw?.prime}), using fallback`);
    console.log(`✅ Rates: prime=${CURRENT_MARKET_RATES.prime} fixed_unlinked=${CURRENT_MARKET_RATES.fixed_unlinked} fixed_linked=${CURRENT_MARKET_RATES.fixed_linked} (source: ${liveRatesUsable ? 'BOI live' : 'fallback'})`);

    const EXPECTED_ANNUAL_INFLATION = 2.5;

    // ━━━ HELPERS ━━━
    const calcLinkedCost = (principal, annualRate, months, customInflation = null) => {
      const monthlyRate = annualRate / 100 / 12;
      const inflRate = Math.pow(1 + (customInflation ?? EXPECTED_ANNUAL_INFLATION) / 100, 1/12) - 1;
      let balance = principal;
      let totalPaid = 0;
      for (let i = 0; i < months; i++) {
        balance *= (1 + inflRate);
        const rem = months - i;
        const payment = balance * (monthlyRate * Math.pow(1 + monthlyRate, rem)) / (Math.pow(1 + monthlyRate, rem) - 1);
        totalPaid += payment;
        balance -= (payment - balance * monthlyRate);
        if (balance < 0) balance = 0;
      }
      return totalPaid;
    };

    const translateTrackType = (trackType) => {
      const t = (trackType || '').toLowerCase();
      if (t.includes('פריים') || t.includes('prime')) return 'פריים';
      if (t.includes('קבוע') || t.includes('fixed')) return (t.includes('לא צמוד') || t.includes('unlinked')) ? 'קבועה לא צמודה' : 'קבועה צמודה';
      if (t.includes('משתנה') || t.includes('variable')) return (t.includes('לא צמוד') || t.includes('unlinked')) ? 'משתנה לא צמודה' : 'משתנה צמודה';
      return trackType;
    };

    const isBondBased = (track) => {
      const b = (track.rate_basis || '').toLowerCase();
      return b.startsWith('v+') || b.startsWith('v-');
    };

    const isTrackCPILinked = (track) => {
      // ━━━ CRITICAL FIX: Track type name takes ABSOLUTE PRIORITY ━━━
      // "משתנה צמודה" is CPI-linked even if rate basis is V+ (bond-based)
      // The bank document's track classification overrides the rate basis
      const type = (track.track_type || '').toLowerCase();

      // "לא צמוד" / "unlinked" in track name → NEVER CPI linked
      if (type.includes('לא צמוד') || type.includes('unlinked')) return false;

      // "צמוד" in track name → ALWAYS CPI linked (covers קבועה צמודה + משתנה צמודה)
      // This is the DEFINITIVE source — V+ basis does NOT override this!
      if (type.includes('צמוד')) return true;

      // Explicit CPI flag from extraction
      if (track.is_index_linked === true) return true;

      // H+ basis explicitly means CPI linked
      const basis = (track.rate_basis || '').toLowerCase();
      if (basis.startsWith('h+') || basis.startsWith('h-')) return true;

      // Prime tracks — never CPI linked
      if (type.includes('פריים') || type.includes('prime')) return false;

      // V+/bond-based with no explicit "צמוד" label → not CPI linked
      if (isBondBased(track)) return false;

      return false;
    };

    // Bank of Israel refinance spec: which published market-average rate a
    // track is measured against is decided purely by its own type/linkage —
    // never a mix of the two (a fixed track is never compared to the variable
    // average, etc).
    const marketRateForTrack = (track) => {
      const type = (track.track_type || '').toLowerCase();
      const isLinked = isTrackCPILinked(track);
      if (type.includes('פריים') || type.includes('prime')) return CURRENT_MARKET_RATES.prime;
      if (type.includes('קבוע')) return isLinked ? CURRENT_MARKET_RATES.fixed_linked : CURRENT_MARKET_RATES.fixed_unlinked;
      if (type.includes('משתנה')) return isLinked ? CURRENT_MARKET_RATES.variable_linked : CURRENT_MARKET_RATES.variable_unlinked;
      return CURRENT_MARKET_RATES.fixed_unlinked; // unrecognized type — conservative fallback
    };

    // Bank of Israel refinance spec: green/red is binary, not a three-way
    // judgment call — a track is "green" (kept untouched) only if its own
    // current rate is strictly below today's published market average for
    // that exact track type; otherwise the balance goes into the refinanced
    // pool. There is no NEUTRAL/borderline zone.
    const classifyTrack = (track) => {
      const rate = track.interest_rate || 0;
      const isLinked = isTrackCPILinked(track);
      // Display-only figure (shown to the borrower as "true cost including
      // CPI drift") — kept separate from the green/red decision itself, which
      // the spec defines as a plain nominal-rate-vs-market-average comparison.
      const effectiveRateCalc = isLinked ? rate + EXPECTED_ANNUAL_INFLATION : rate;
      const marketRate = marketRateForTrack(track);
      return rate < marketRate
        ? { status: 'GOLDEN', effectiveRate: effectiveRateCalc, marketRate, reason: `ירוק - ${rate.toFixed(2)}% מתחת לממוצע השוק (${marketRate.toFixed(2)}%)` }
        : { status: 'TOXIC', effectiveRate: effectiveRateCalc, marketRate, reason: `אדום - ${rate.toFixed(2)}% מעל/שווה לממוצע השוק (${marketRate.toFixed(2)}%)` };
    };

    // ━━━ BALANCE RESOLUTION ━━━
    let actualRemainingBalance = 0;
    const tracks = extractionResult.tracks || [];

    if (tracks.length > 0) {
      actualRemainingBalance = tracks.reduce((s, t) => s + (t.remaining_balance || 0), 0);
    }
    if (actualRemainingBalance === 0 && (extractionResult.remaining_balance || 0) > 0) {
      actualRemainingBalance = extractionResult.remaining_balance;
    }

    // ━━━ VALIDATION — reject if no financial data at all ━━━
    const hasTracks = tracks.length > 0 && tracks.some(t => (t.remaining_balance || 0) > 0);
    const hasBalance = actualRemainingBalance > 0;
    const hasMonthlyPayment = (extractionResult.monthly_payment || 0) > 0;

    if (!hasTracks && !hasBalance && !hasMonthlyPayment) {
      return jsonResponse({
        success: false,
        error: 'לא הצלחנו לזהות נתוני משכנתא במסמך זה. ודא שהקובץ הוא דף יתרת סילוק ברור וקריא, ונסה שוב.',
        errorCode: 'NOT_A_PAYOFF_STATEMENT'
      }, { status: 200 });
    }

    // ━━━ If no tracks but has balance — attempt one more targeted extraction ━━━
    if (!hasTracks && hasBalance) {
      console.log(`⚠️ No tracks found but balance=₪${actualRemainingBalance.toLocaleString()} — retrying track extraction...`);
      try {
        const retry = await invokeGeminiWithRetry({
          model: GEMINI_MODEL,
          prompt: `This is an Israeli mortgage payoff statement. I need to find all individual loan tracks (מסלולים/הלוואות).
The document shows balance ₪${actualRemainingBalance.toLocaleString()} total.
Find EACH individual track and extract:
- track_type: פריים / קבועה לא צמודה / קבועה צמודה / משתנה לא צמודה / משתנה צמודה
- remaining_balance: יתרת קרן per track (NOT original amount)
- interest_rate: current rate in percent
- remaining_months: months until end date from today (${today})
- is_index_linked: true only for CPI/מדד-linked tracks
- prepayment_fee: עמלת פירעון מוקדם per track (can be ₪0)
Today: ${today}`,
          files: [documentFile],
          schema: {
            type: "object",
            properties: {
              tracks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    track_type: { type: "string" },
                    remaining_balance: { type: "number" },
                    interest_rate: { type: "number" },
                    remaining_months: { type: "number" },
                    is_index_linked: { type: "boolean" },
                    rate_basis: { type: ["string", "null"] },
                    prepayment_fee: { type: ["number", "null"] }
                  }
                }
              },
              total_fee: { type: ["number", "null"] }
            }
          }
        });

        const validTracks = (retry.tracks || []).filter(t => (t.remaining_balance || 0) > 0 && (t.remaining_months || 0) > 0);
        if (validTracks.length > 0) {
          const tracksSum = validTracks.reduce((s, t) => s + t.remaining_balance, 0);
          // Scale to match known balance if needed
          if (Math.abs(tracksSum - actualRemainingBalance) / actualRemainingBalance > 0.05) {
            const scale = actualRemainingBalance / tracksSum;
            validTracks.forEach(t => { t.remaining_balance = Math.round(t.remaining_balance * scale); });
          }
          extractionResult.tracks = validTracks;
          if (retry.total_fee !== null && retry.total_fee !== undefined) {
            extractionResult.total_early_repayment_fee = retry.total_fee;
          }
          console.log(`✅ Retry found ${validTracks.length} tracks`);
        } else {
          return jsonResponse({
            success: false,
            error: 'לא הצלחנו לזהות את פרטי המסלולים במסמך. ייתכן שהמסמך לא ברור מספיק. אנא נסה להעלות קובץ PDF ברור יותר.',
            errorCode: 'TRACK_EXTRACTION_FAILED'
          }, { status: 200 });
        }
      } catch(e) {
        console.warn('Retry extraction failed:', e.message);
        return jsonResponse({
          success: false,
          error: 'שגיאה בניתוח המסמך. אנא נסה שוב.',
          errorCode: 'TRACK_EXTRACTION_FAILED'
        }, { status: 200 });
      }
    }

    const arrearsDebt = extractionResult.arrears_debt || 0;
    actualRemainingBalance = Math.round(actualRemainingBalance + arrearsDebt);

    // Log tracks for debugging
    (extractionResult.tracks || []).forEach((t, i) => {
      console.log(`  Track ${i+1}: ${t.track_type} | rate=${t.interest_rate}% | bal=₪${t.remaining_balance?.toLocaleString()} | months=${t.remaining_months} | linked=${t.is_index_linked} | basis=${t.rate_basis}`);
    });

    // ━━━ EARLY REPAYMENT FEE ━━━
    if ((extractionResult.total_early_repayment_fee === null || extractionResult.total_early_repayment_fee === undefined) && (extractionResult.tracks || []).length > 0) {
      const sumFromTracks = (extractionResult.tracks || []).reduce((s, t) => s + (t.prepayment_fee || 0), 0);
      if (sumFromTracks > 0) {
        extractionResult.total_early_repayment_fee = sumFromTracks;
        console.log(`✅ Fee from track sum: ₪${sumFromTracks}`);
      }
    }

    let earlyRepaymentFee = 0;
    let feeConfidence = 0;
    let feeWarning = null;
    let feeExemptionReason = null;

    if (extractionResult.total_early_repayment_fee !== null && extractionResult.total_early_repayment_fee !== undefined) {
      earlyRepaymentFee = Math.round(extractionResult.total_early_repayment_fee);
      feeConfidence = 90;
    } else if ((extractionResult.tracks || []).every(t => (t.track_type || '').includes('פריים'))) {
      earlyRepaymentFee = 0; feeConfidence = 100;
      feeExemptionReason = 'מסלולי פריים - ללא עמלת פירעון';
    } else {
      feeWarning = 'לא נמצאה עמלת פירעון - יש לאמת ידנית מול הבנק';
    }

    const bankFees = 360;
    const totalCost = earlyRepaymentFee + bankFees;

    // ━━━ WEIGHTED PERIOD ━━━
    let weightedPeriodMonths = extractionResult.remaining_months || 240;
    const allTracks = extractionResult.tracks || [];
    if (allTracks.length > 0) {
      const totalBal = allTracks.reduce((s, t) => s + (t.remaining_balance || 0), 0);
      if (totalBal > 0) {
        weightedPeriodMonths = Math.round(allTracks.reduce((s, t) => s + (t.remaining_months || 0) * (t.remaining_balance || 0), 0) / totalBal);
      }
    }
    if (!weightedPeriodMonths || weightedPeriodMonths <= 0) weightedPeriodMonths = 240;
    const weightedPeriodYears = Math.ceil(weightedPeriodMonths / 12);

    let maxAge = 40;
    if (extractionResult.borrower_1?.age) maxAge = Math.max(maxAge, extractionResult.borrower_1.age);
    if (extractionResult.borrower_2?.age) maxAge = Math.max(maxAge, extractionResult.borrower_2.age);
    // Regulatory cap: 30 years, or shorter if the age-85 ceiling binds first.
    const REGULATORY_MAX_AGE = 85;
    const REGULATORY_MAX_YEARS = 30;
    const maxAllowedYears = Math.max(5, Math.min(REGULATORY_MAX_YEARS, REGULATORY_MAX_AGE - maxAge));

    // ━━━ OLD MORTGAGE TOTAL COST ━━━
    let totalOldPayments = 0;
    if (allTracks.length > 0) {
      allTracks.forEach(track => {
        const linked = isTrackCPILinked(track);
        const annualRate = track.interest_rate || 0;
        const monthlyRate = annualRate / 100 / 12;
        const months = track.remaining_months || 0;
        const balance = track.remaining_balance || 0;
        if (months <= 0 || balance <= 0) return;
        const paymentMethod = (track.payment_method || '').toLowerCase();
        let trackCost = 0;
        if (paymentMethod.includes('ריבית בלבד') || paymentMethod.includes('בלון') || paymentMethod.includes('bullet')) {
          trackCost = (balance * monthlyRate * months) + balance;
        } else if (linked) {
          trackCost = calcLinkedCost(balance, annualRate, months);
        } else {
          const payment = balance * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
          trackCost = payment * months;
        }
        totalOldPayments += trackCost;
        console.log(`  Track cost: ${track.track_type} | linked=${linked} | ₪${balance.toLocaleString()} × ${months}mo = ₪${Math.round(trackCost).toLocaleString()}`);
      });
    } else if (extractionResult.monthly_payment > 0 && weightedPeriodMonths > 0) {
      totalOldPayments = extractionResult.monthly_payment * weightedPeriodMonths;
    }
    // ━━━ NEW MORTGAGE ━━━
    const avgPrime = CURRENT_MARKET_RATES.prime;
    const avgFixedUnlinked = CURRENT_MARKET_RATES.fixed_unlinked;
    const avgVariableUnlinked = CURRENT_MARKET_RATES.variable_unlinked;
    const avgNewRate = (avgPrime * 0.67) + (avgFixedUnlinked * 0.20) + (avgVariableUnlinked * 0.13);
    const totalNewPrincipal = actualRemainingBalance + earlyRepaymentFee + bankFees;
    const monthlyNewRate = avgNewRate / 100 / 12;
    const newMonthlyPaymentTotal = totalNewPrincipal * (monthlyNewRate * Math.pow(1 + monthlyNewRate, weightedPeriodMonths)) / (Math.pow(1 + monthlyNewRate, weightedPeriodMonths) - 1);
    const totalNewPayments = newMonthlyPaymentTotal * weightedPeriodMonths;
    // ━━━ EXISTING MONTHLY PAYMENT ━━━
    const existingMonthlyPayment = extractionResult.monthly_payment || (() => {
      if (!allTracks.length) return 0;
      return allTracks.reduce((s, t) => {
        const r = (t.interest_rate || 0) / 100 / 12;
        const n = t.remaining_months || 0;
        const b = t.remaining_balance || 0;
        if (r === 0 || n === 0 || b === 0) return s;
        return s + b * (r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
      }, 0);
    })();
    console.log(`📊 totalOldPayments=₪${Math.round(totalOldPayments).toLocaleString()} | weightedMonths=${weightedPeriodMonths} | existingMonthly=₪${Math.round(existingMonthlyPayment).toLocaleString()}`);

    // ━━━ INDEX DAMAGE — pre-calculation placeholder (computed properly later in INDEX DAMAGE LIFETIME section) ━━━
    // totalIndexDamageLifetime מחושב לאחר בניית indexDamageAlerts — משמש כאן רק כהפניה
    // לא מחשבים כאן כדי למנוע כפילות חישוב

    // ━━━ SAVINGS ━━━
    // gross = totalOldPayments(עם מדד) - totalNewPayments(ללא מדד)
    // זה כולל את ביטול נזק המדד בתוכו.
    // ה-netSavings = gross - fees.
    // monthlySavings = מחושב ישירות מהחזר חודשי, לא מחלוקת gross/months (שמביאה לתוצאה שגויה)
    const calculateFinalSavings = (oldCost, newCost, fee, periodMonths = null, newMonthly = null) => {
      const gross = oldCost - newCost;
      const net = gross - fee - bankFees;
      const months = periodMonths || weightedPeriodMonths || 240;
      const monthlySavings = newMonthly !== null ? Math.round(existingMonthlyPayment - newMonthly) : Math.round(gross / months);
      return { grossSavings: Math.round(gross), netSavings: Math.round(net), monthlySavings, isWorthwhile: net > 10000 };
    };

    // ━━━ INDEX DAMAGE LIFETIME — חישוב מוקדם לשימוש ב-netSavings הראשי ━━━
    // חישוב נזק המדד המלא (Lifetime) על כל המסלולים הצמודים
    // base = עלות ללא מדד (inflation=0), indexed = עלות עם מדד — ההפרש הוא הנזק האמיתי
    const calcIndexDamageLifetime = (tracks) => {
      let total = 0;
      tracks.forEach(track => {
        if (isTrackCPILinked(track) && (track.remaining_balance || 0) > 0 && (track.remaining_months || 0) > 0) {
          const base = calcLinkedCost(track.remaining_balance, track.interest_rate, track.remaining_months, 0);
          const indexed = calcLinkedCost(track.remaining_balance, track.interest_rate, track.remaining_months);
          total += Math.max(0, indexed - base);
        }
      });
      return Math.round(total);
    };

    // ━━━ SURGICAL SAVINGS: חיסכון רק על המסלולים הרעילים ━━━
    // עבור מחזור כירורגי, החיסכון צריך להיות: עלות מסלולים רעילים עכשיו (עם מדד) - עלותם לאחר מחזור
    // ולא: עלות כל המשכנתא לפני vs. כל המשכנתא לאחר (שמעניש על שמירת הקבועה הזולה)
    let surgicalOldCost = 0, surgicalNewCost = 0, surgicalBalance = 0, surgicalAvgMonths = 0;

    // Pre-classify tracks to compute surgical savings before savingsResult
    const preClassified = allTracks.map(track => ({ track, classification: classifyTrack(track) }));
    const goldenTracksForSavings = preClassified.filter(({ classification }) => classification.status === 'GOLDEN').map(({ track }) => track);
    // Per the Bank of Israel refinance spec, green tracks are kept untouched
    // whenever ANY exist — the split is binary (green vs. everything else),
    // with no separate carve-out for TOXIC vs. merely NEUTRAL tracks. Surgical
    // mode used to also require a TOXIC track to exist, which meant a mortgage
    // with a green track but only NEUTRAL siblings got fully refinanced
    // instead of preserving the green one — that was wrong.
    const nonGreenTracksForSavings = preClassified.filter(({ classification }) => classification.status !== 'GOLDEN').map(({ track }) => track);
    const isSurgicalMode = goldenTracksForSavings.length > 0;

    if (isSurgicalMode) {
      // עלות מסלולים רעילים קיימים (עם מדד אם צמוד)
      // surgicalAvgMonths = ממוצע משוקלל לפי יתרה (לא ממוצע פשוט)
      let surgicalWeightedMonthsSum = 0;
      nonGreenTracksForSavings.forEach(t => {
        const linked = isTrackCPILinked(t);
        const bal = t.remaining_balance || 0;
        const months = t.remaining_months || 0;
        if (bal <= 0 || months <= 0) return;
        surgicalBalance += bal;
        surgicalWeightedMonthsSum += months * bal;
        if (linked) {
          surgicalOldCost += calcLinkedCost(bal, t.interest_rate, months);
        } else {
          const r = t.interest_rate / 100 / 12;
          surgicalOldCost += bal * (r * Math.pow(1+r, months)) / (Math.pow(1+r, months) - 1) * months;
        }
      });
      // ממוצע משוקלל לפי יתרה — נותן תמונה נכונה יותר של תקופת ההלוואה החדשה
      surgicalAvgMonths = surgicalBalance > 0 ? Math.round(surgicalWeightedMonthsSum / surgicalBalance) : weightedPeriodMonths;
      // עלות מסלולים רעילים לאחר מחזור (ריבית שוק חדשה, ללא מדד)
      const newR = avgNewRate / 100 / 12;
      surgicalNewCost = surgicalBalance * (newR * Math.pow(1+newR, surgicalAvgMonths)) / (Math.pow(1+newR, surgicalAvgMonths) - 1) * surgicalAvgMonths;
      console.log(`🔪 Surgical setup: balance=₪${Math.round(surgicalBalance).toLocaleString()} | months=${surgicalAvgMonths} | oldCost=₪${Math.round(surgicalOldCost).toLocaleString()} | newRate=${avgNewRate.toFixed(2)}% | newCost=₪${Math.round(surgicalNewCost).toLocaleString()}`);
    }

    // ━━━ savingsResult: כירורגי = חיסכון על הרעילים בלבד (כולל נזק מדד Lifetime); מלא = כל המשכנתא ━━━
    let savingsResult;
    if (isSurgicalMode) {
      // surgicalOldCost = עלות מסלולים רעילים קיימים עם מדד (כולל הצמדה)
      // surgicalNewCost = עלות אותם מסלולים אחרי מחזור לריבית שוק (ללא הצמדה)
      // ה-gross כבר מגלם: חיסכון ריבית + ביטול נזק מדד על המסלולים הרעילים

      // חיסכון חודשי כירורגי: התשלום הנוכחי על הרעילים מול התשלום החדש עליהם
      let currentToxicMonthly = 0, newToxicMonthly = 0;
      nonGreenTracksForSavings.forEach(t => {
        const r = t.interest_rate / 100 / 12;
        const n = t.remaining_months || 0;
        const b = t.remaining_balance || 0;
        if (r > 0 && n > 0 && b > 0) currentToxicMonthly += b * (r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
      });
      const newR = avgNewRate / 100 / 12;
      newToxicMonthly = surgicalBalance * (newR * Math.pow(1+newR, surgicalAvgMonths)) / (Math.pow(1+newR, surgicalAvgMonths) - 1);
      const monthlySavings = Math.round(currentToxicMonthly - newToxicMonthly);

      // netSavings = gross כירורגי (ריבית + ביטול מדד על רעילים) - עמלות
      const gross = surgicalOldCost - surgicalNewCost;
      const net = gross - earlyRepaymentFee - bankFees;
      console.log(`🔪 Surgical: oldCost=₪${Math.round(surgicalOldCost).toLocaleString()} | newCost=₪${Math.round(surgicalNewCost).toLocaleString()} | gross=₪${Math.round(gross).toLocaleString()} | net=₪${Math.round(net).toLocaleString()}`);
      savingsResult = { grossSavings: Math.round(gross), netSavings: Math.round(net), monthlySavings, isWorthwhile: net > 5000 };
    } else {
      savingsResult = calculateFinalSavings(totalOldPayments, totalNewPayments, earlyRepaymentFee, null, newMonthlyPaymentTotal);
    }
    const { grossSavings, monthlySavings } = savingsResult;

    // חיסכון חודשי כולל (להצגה בסיכום): הפרש ההחזר החודשי הכולל לפני ואחרי
    const overallMonthlySavings = Math.round(existingMonthlyPayment - newMonthlyPaymentTotal);

    // ━━━ SENSITIVITY ANALYSIS — ייאותחל אחרי חישוב netSavings ━━━
    const sensitivityAnalysis = { optimistic: null, realistic: null, pessimistic: null };
    const hasTrueCPILinked = allTracks.some(t => isTrackCPILinked(t));
    if (hasTrueCPILinked) {
      const calcOldCostAtInflation = (inflationPct) => {
        let cost = 0;
        allTracks.forEach(track => {
          const linked = isTrackCPILinked(track);
          const months = track.remaining_months || 0;
          const balance = track.remaining_balance || 0;
          const rate = track.interest_rate || 0;
          if (months <= 0 || balance <= 0) return;
          if (linked) {
            cost += calcLinkedCost(balance, rate, months, inflationPct);
          } else {
            const r = rate / 100 / 12;
            cost += balance * (r * Math.pow(1+r, months)) / (Math.pow(1+r, months) - 1) * months;
          }
        });
        return cost;
      };
      // בתיק כירורגי: השוואה נגד עלות המסלולים הרעילים בלבד (לא כל המשכנתא)
      const calcReferenceCost = (inflationPct) => {
        if (!isSurgicalMode) return calcOldCostAtInflation(inflationPct);
        let cost = 0;
        nonGreenTracksForSavings.forEach(track => {
          const linked = isTrackCPILinked(track);
          const months = track.remaining_months || 0;
          const balance = track.remaining_balance || 0;
          const rate = track.interest_rate || 0;
          if (months <= 0 || balance <= 0) return;
          if (linked) {
            cost += calcLinkedCost(balance, rate, months, inflationPct);
          } else {
            const rr = rate / 100 / 12;
            cost += balance * (rr * Math.pow(1+rr, months)) / (Math.pow(1+rr, months) - 1) * months;
          }
        });
        return cost;
      };
      const newCostRef = isSurgicalMode ? surgicalNewCost : totalNewPayments;
      sensitivityAnalysis.optimistic = Math.round(calcReferenceCost(2.0) - newCostRef - totalCost);
      sensitivityAnalysis.pessimistic = Math.round(calcReferenceCost(3.5) - newCostRef - totalCost);
      if (sensitivityAnalysis.optimistic > sensitivityAnalysis.pessimistic) {
        [sensitivityAnalysis.optimistic, sensitivityAnalysis.pessimistic] = [sensitivityAnalysis.pessimistic, sensitivityAnalysis.optimistic];
      }
    }

    // ━━━ INDEX DAMAGE LIFETIME — חוק 2 (Inflation Lifetime) ━━━
    // בתיק כירורגי: נזק המדד מחושב רק על המסלולים שמוחזרים (הרעילים) — לא על הזהב שנשמר.
    // אם שומרים מסלול צמוד (זהב), לא ניתן לטעון שביטלנו את הצמדה שלו.
    // calcLinkedCost עם inflation=0 = עלות נטו ריבית בלבד (בסיס)
    // calcLinkedCost עם inflation=2.5% = עלות כוללת ריבית + הצמדה (indexed)
    // נזק = indexed - base = הנזק הטהור מהצמדה למדד לכל תקופת המסלול
    const indexDamageAlerts = [];
    // tracksForIndexDamage: בכירורגי — רק הרעילים; במלא — כולם
    const tracksForIndexDamage = isSurgicalMode ? nonGreenTracksForSavings : allTracks;
    tracksForIndexDamage.forEach(track => {
      if (isTrackCPILinked(track) && (track.remaining_balance || 0) > 0 && (track.remaining_months || 0) > 0) {
        const n = track.remaining_months; // כל חודשי המסלול — לא רק 60 חודשים!
        const base = calcLinkedCost(track.remaining_balance, track.interest_rate, n, 0);   // ללא מדד
        const indexed = calcLinkedCost(track.remaining_balance, track.interest_rate, n);    // עם מדד 2.5% Lifetime
        const damage = Math.round(indexed - base);
        if (damage > 0) {
          indexDamageAlerts.push({
            track_type: translateTrackType(track.track_type),
            balance: track.remaining_balance,
            months: n,
            indexDamage: damage,
            note: `מדד יוסיף ₪${damage.toLocaleString()} לאורך כל ${Math.round(n/12)} שנות המסלול (Lifetime)`
          });
          console.log(`  💥 Index damage [${track.track_type}]: ₪${track.remaining_balance?.toLocaleString()} × ${n}mo = ₪${damage.toLocaleString()} (base=₪${Math.round(base).toLocaleString()} → indexed=₪${Math.round(indexed).toLocaleString()})`);
        }
      }
    });

    // totalIndexDamageLifetime = סך נזק המדד המלא על כל המסלולים הצמודים לכל תקופתם
    const totalIndexDamageLifetime = indexDamageAlerts.reduce((s, a) => s + (a.indexDamage || 0), 0);
    console.log(`🛡️ totalIndexDamageLifetime=₪${totalIndexDamageLifetime.toLocaleString()} (across ${indexDamageAlerts.length} linked tracks)`);
    console.log(`🔍 Index damage detail:`, indexDamageAlerts.map(a => `${a.track_type}: ₪${a.indexDamage?.toLocaleString()} (${a.months}mo)`).join(' | '));

    // ━━━ NET SAVINGS — השורה התחתונה האמיתית (finalTotalNetSavings) ━━━
    // חוק 3 (Executive Aggregation): הרווח הכלכלי נטו = MAX של כל החישובים:
    //   (א) savingsResult.netSavings — חיסכון כירורגי/מלא (ריבית + מדד רעילים)
    //   (ב) totalIndexDamageLifetime - totalCost — מגן מדד Lifetime נטו מעמלות
    //   (ג) totalOldPayments - totalNewPayments - totalCost — חיסכון ריאלי מלא
    // NOTE: strategyA.netSavings מחושב בתוך dualStrategy בהמשך ונכלל בהסוף
    // לא ייתכן שהרווח הנטו קטן ממגן המדד לבדו!
    const fullRefinanceSavings = Math.round(totalOldPayments - totalNewPayments - totalCost);
    const indexShieldNet = Math.round(totalIndexDamageLifetime - totalCost);

    // ━━━ STRATEGY A PRE-CALC: חישוב מוקדם של oldCostLifetime לשימוש ב-MAX ━━━
    // אותו חישוב שיתבצע בתוך dualStrategy — מחשבים כאן כדי לכלול ב-MAX
    const tracksForComparisonPreCalc = isSurgicalMode ? nonGreenTracksForSavings : allTracks;
    let oldCostLifetimePreCalc = 0;
    tracksForComparisonPreCalc.forEach(track => {
      const linked = isTrackCPILinked(track);
      const annualRate = track.interest_rate || 0;
      const balance = track.remaining_balance || 0;
      const rTrack = annualRate / 100 / 12;
      const months = track.remaining_months || weightedPeriodMonths;
      if (balance <= 0 || months <= 0) return;
      if (linked) {
        oldCostLifetimePreCalc += calcLinkedCost(balance, annualRate, months);
      } else {
        const pmt = balance * (rTrack * Math.pow(1+rTrack, months)) / (Math.pow(1+rTrack, months) - 1);
        oldCostLifetimePreCalc += pmt * months;
      }
    });
    // Strategy A principal: same logic as dualStrategy
    const surgicalPrincipalPreCalc = isSurgicalMode ? surgicalBalance + earlyRepaymentFee + bankFees : actualRemainingBalance + earlyRepaymentFee + bankFees;
    // Strategy A: shortest period where new payment ≤ current × 1.15
    const currentMonthlyPreCalc = extractionResult.monthly_payment || Math.round(existingMonthlyPayment);
    const r_preCalc = avgNewRate / 100 / 12;
    let strategyAYearsPreCalc = weightedPeriodYears;
    const refMonthlyPreCalc = isSurgicalMode
      ? nonGreenTracksForSavings.reduce((s, t) => { const rr = t.interest_rate/100/12; const n = t.remaining_months||0; const b = t.remaining_balance||0; return (rr>0&&n>0&&b>0) ? s + b*(rr*Math.pow(1+rr,n))/(Math.pow(1+rr,n)-1) : s; }, 0)
      : currentMonthlyPreCalc;
    const maxYearsPreCalc = isSurgicalMode ? Math.ceil((surgicalAvgMonths || weightedPeriodMonths) / 12) : weightedPeriodYears;
    let mixSavingsPeriodYears = maxYearsPreCalc;
    for (let y = 10; y <= maxYearsPreCalc; y++) {
      const m = y * 12;
      const pmt = surgicalPrincipalPreCalc * (r_preCalc * Math.pow(1+r_preCalc, m)) / (Math.pow(1+r_preCalc, m) - 1);
      if (pmt <= refMonthlyPreCalc * 1.15) {
        strategyAYearsPreCalc = y;
        mixSavingsPeriodYears = y;
        break;
      }
    }
    const strategyAMonthsPreCalc = strategyAYearsPreCalc * 12;
    const strategyAMonthlyPreCalc = surgicalPrincipalPreCalc * (r_preCalc * Math.pow(1+r_preCalc, strategyAMonthsPreCalc)) / (Math.pow(1+r_preCalc, strategyAMonthsPreCalc) - 1);
    const strategyANetSavingsPreCalc = Math.round(oldCostLifetimePreCalc - (strategyAMonthlyPreCalc * strategyAMonthsPreCalc) - totalCost);
    console.log(`📐 Pre-calc StrategyA: oldLifetime=₪${Math.round(oldCostLifetimePreCalc).toLocaleString()} | newTotal=₪${Math.round(strategyAMonthlyPreCalc * strategyAMonthsPreCalc).toLocaleString()} | netSavings=₪${strategyANetSavingsPreCalc.toLocaleString()}`);

    // ━━━ Strategy B pre-calc: חישוב oxygenNetSavings מוקדם לשימוש ב-FINAL_NET ━━━
    const oxygenYearsPreCalc = Math.min(30, maxAllowedYears);
    const oxygenMonthsPreCalc = oxygenYearsPreCalc * 12;
    const surgicalPrincipalB = isSurgicalMode ? surgicalBalance + earlyRepaymentFee + bankFees : actualRemainingBalance + earlyRepaymentFee + bankFees;
    const r_b = avgNewRate / 100 / 12;
    const oxygenMonthlyPreCalc = surgicalPrincipalB * (r_b * Math.pow(1+r_b, oxygenMonthsPreCalc)) / (Math.pow(1+r_b, oxygenMonthsPreCalc) - 1);
    const tracksForCompPreCalc = isSurgicalMode ? nonGreenTracksForSavings : allTracks;
    let oldCostForOxygenPreCalc = 0;
    tracksForCompPreCalc.forEach(track => {
      const linked = isTrackCPILinked(track);
      const annualRate = track.interest_rate || 0;
      const balance = track.remaining_balance || 0;
      const rTrack = annualRate / 100 / 12;
      const trackMonths = track.remaining_months || weightedPeriodMonths;
      if (balance <= 0 || trackMonths <= 0) return;
      const effectiveMonths = Math.max(trackMonths, oxygenMonthsPreCalc);
      if (linked) {
        oldCostForOxygenPreCalc += calcLinkedCost(balance, annualRate, effectiveMonths);
      } else {
        const pmt = balance * (rTrack * Math.pow(1+rTrack, effectiveMonths)) / (Math.pow(1+rTrack, effectiveMonths) - 1);
        oldCostForOxygenPreCalc += pmt * effectiveMonths;
      }
    });
    const strategyBNetSavingsPreCalc = Math.round(oldCostForOxygenPreCalc - (oxygenMonthlyPreCalc * oxygenMonthsPreCalc) - totalCost);
    console.log(`📐 Pre-calc StrategyB (oxygen): net=₪${strategyBNetSavingsPreCalc.toLocaleString()}`);

    // finalTotalNetSavings = MAX של כל האסטרטגיות — מספר אחד, עקבי, בכל הדוח
    const FINAL_NET = Math.max(savingsResult.netSavings, indexShieldNet, fullRefinanceSavings, strategyANetSavingsPreCalc, strategyBNetSavingsPreCalc);
    const netSavings = FINAL_NET; // alias — כל הקוד משתמש בשם netSavings
    console.log(`💰 FINAL_NET=₪${FINAL_NET.toLocaleString()} | surgical=₪${savingsResult.netSavings.toLocaleString()} | indexShieldNet=₪${indexShieldNet.toLocaleString()} | fullRefinance=₪${fullRefinanceSavings.toLocaleString()} | strategyA=₪${strategyANetSavingsPreCalc.toLocaleString()} | strategyB=₪${strategyBNetSavingsPreCalc.toLocaleString()}`);

    // ━━━ SENSITIVITY SYNC — realistic = FINAL_NET (Single Source of Truth) ━━━
    sensitivityAnalysis.realistic = FINAL_NET;
    // אם יש מסלולים צמודים: חשב optimistic/pessimistic ביחס ל-netSavings הסופי
    // הפרש בין realistic(2.5%) לoptimistic(2.0%)/pessimistic(3.5%) נשמר, אבל הבסיס = netSavings
    if (sensitivityAnalysis.optimistic !== null && sensitivityAnalysis.pessimistic !== null) {
      // הפרש יחסי: כמה פחות/יותר מדד 2.0% vs 3.5% ביחס ל-2.5%
      const baseOldCost = isSurgicalMode ? surgicalOldCost : totalOldPayments;
      const baseNewCost = isSurgicalMode ? surgicalNewCost : totalNewPayments;
      const baseNet = Math.round(baseOldCost - baseNewCost - totalCost);
      const deltaOpt = sensitivityAnalysis.optimistic - baseNet;
      const deltaPess = sensitivityAnalysis.pessimistic - baseNet;
      // apply same deltas on top of the true finalTotalNetSavings
      sensitivityAnalysis.optimistic = Math.round(netSavings + deltaOpt);
      sensitivityAnalysis.pessimistic = Math.round(netSavings + deltaPess);
      // ensure ordering: optimistic < realistic < pessimistic (higher inflation = higher savings from linked tracks)
      if (sensitivityAnalysis.optimistic > sensitivityAnalysis.pessimistic) {
        [sensitivityAnalysis.optimistic, sensitivityAnalysis.pessimistic] = [sensitivityAnalysis.pessimistic, sensitivityAnalysis.optimistic];
      }
    } else if (sensitivityAnalysis.optimistic === null) {
      // תיק ללא מסלולים צמודים — כל 3 הערכים זהים
      sensitivityAnalysis.optimistic = netSavings;
      sensitivityAnalysis.pessimistic = netSavings;
    }

    // ━━━ SURGICAL ANALYSIS (reuse preClassified) ━━━
    const surgicalAnalysis = { goldenAssets: [], toxicTracks: [], neutralTracks: [] };
    preClassified.forEach(({ track, classification }) => {
      const withClass = { ...track, classification };
      if (classification.status === 'GOLDEN') surgicalAnalysis.goldenAssets.push(withClass);
      else if (classification.status === 'TOXIC') surgicalAnalysis.toxicTracks.push(withClass);
      else surgicalAnalysis.neutralTracks.push(withClass);
    });

    // בתיק כירורגי: תמהילים יחושבו לפי החלק שממחזרים בלבד (surgicalBalance + fees)
    const mixBasePrincipal = isSurgicalMode ? (surgicalBalance + earlyRepaymentFee + bankFees) : actualRemainingBalance;

    // Strategy-specific mixes are now calculated only after the borrower
    // chooses a goal. Keep the exact inputs used by the existing mix formulas
    // so the follow-up Edge Function can reproduce them without changing any
    // refinance assumptions.
    const mixCalculationContext = {
      analysisRevision: crypto.randomUUID(),
      mixBasePrincipal,
      actualRemainingBalance,
      isSurgicalMode,
      goldenTracks: goldenTracksForSavings.map((track) => ({
        track_type: translateTrackType(track.track_type),
        remaining_balance: track.remaining_balance,
        interest_rate: track.interest_rate,
        remaining_months: track.remaining_months,
      })),
      existingMonthlyPayment,
      totalOldPayments,
      weightedPeriodMonths,
      earlyRepaymentFee,
      bankFees,
      // is_green rides along per-track so the mix generator can split the
      // non-green balance into fixed-type vs. variable-type pools itself,
      // without re-deriving green/red from scratch or matching by value
      // against goldenTracks.
      allTracks: preClassified.map(({ track, classification }) => ({
        track_type: translateTrackType(track.track_type),
        remaining_balance: track.remaining_balance,
        interest_rate: track.interest_rate,
        remaining_months: track.remaining_months,
        is_index_linked: isTrackCPILinked(track),
        is_green: classification.status === 'GOLDEN',
      })),
      expectedAnnualInflation: EXPECTED_ANNUAL_INFLATION,
      marketRates: CURRENT_MARKET_RATES,
      // Regulatory ceiling (age-85 cap / 30 years, whichever binds first) for
      // any new track's period.
      maxAllowedYears,
    };

    // ━━━ EQUITY RELEASE ━━━
    let equityReleaseAnalysis = null;
    const externalDebts = external_debts_input?.length > 0 ? external_debts_input : (extractionResult.external_debts || []);
    if (externalDebts?.length > 0) {
      const propertyValue = extractionResult.estimated_property_value || 0;
      const externalTotal = externalDebts.reduce((s, d) => s + (d.remaining_balance || 0), 0) + arrearsDebt;
      const externalMonthly = externalDebts.reduce((s, d) => s + (d.monthly_repayment || 0), 0);
      const totalNewLoan = actualRemainingBalance + externalTotal;
      const ltvRatio = propertyValue > 0 ? (totalNewLoan / propertyValue) * 100 : 0;
      const allPurposeRate = avgNewRate + 1.5;
      const r = allPurposeRate / 100 / 12;
      const rHousing = avgNewRate / 100 / 12;
      const m = 240;
      const newPayment = totalNewLoan * (r * Math.pow(1+r, m)) / (Math.pow(1+r, m) - 1);
      const currentBurden = (extractionResult.monthly_payment || existingMonthlyPayment || 0) + externalMonthly;
      const housingPayment = actualRemainingBalance * (rHousing * Math.pow(1+rHousing, m)) / (Math.pow(1+rHousing, m) - 1);
      const allPurposePayment = externalTotal > 0 ? externalTotal * (r * Math.pow(1+r, m)) / (Math.pow(1+r, m) - 1) : 0;
      const totalCombined = Math.round(housingPayment + allPurposePayment);
      const weightedRate = totalNewLoan > 0 ? parseFloat(((actualRemainingBalance * avgNewRate + externalTotal * allPurposeRate) / totalNewLoan).toFixed(2)) : parseFloat(allPurposeRate.toFixed(2));

      equityReleaseAnalysis = {
        propertyValue: Math.round(propertyValue), currentMortgageBalance: actualRemainingBalance,
        totalExternalDebt: Math.round(externalTotal), totalNewLoan: Math.round(totalNewLoan),
        ltvRatio: parseFloat(ltvRatio.toFixed(2)), currentMonthlyBurden: Math.round(currentBurden),
        newMonthlyPayment: Math.round(newPayment), monthlyCashFlowImprovement: Math.round(currentBurden - newPayment),
        allPurposeRate: parseFloat(allPurposeRate.toFixed(2)),
        status: ltvRatio > 70 ? 'HIGH_RISK_LTV' : ltvRatio > 50 ? 'MODERATE_LTV' : 'HEALTHY_LTV',
        isWorthwhile: (currentBurden - newPayment) > 2000 && ltvRatio <= 70,
        externalDebts,
        splitAnalysis: {
          housingPortion: { label: 'רכיב דיור (מחזור משכנתא)', amount: Math.round(actualRemainingBalance), rate: parseFloat(avgNewRate.toFixed(2)), monthlyImpact: Math.round(housingPayment) },
          allPurposePortion: { label: 'רכיב לכל מטרה (איחוד חובות)', amount: Math.round(externalTotal), rate: parseFloat(allPurposeRate.toFixed(2)), monthlyImpact: Math.round(allPurposePayment) },
          combinedTotal: { totalPrincipal: Math.round(totalNewLoan), totalMonthly: totalCombined, weightedRate, beforeTotal: Math.round(currentBurden), netSavings: Math.max(0, Math.round(currentBurden) - totalCombined) }
        }
      };
    }

    // ━━━ STRATEGY ━━━
    let strategy = { type: 'NO_REFINANCE', title: 'המשכנתא מצוינת', icon: '✅', description: 'ריביות קיימות טובות מהשוק' };
    if (surgicalAnalysis.toxicTracks.length > 0 && surgicalAnalysis.goldenAssets.length > 0) {
      strategy = { type: 'SURGICAL', title: 'מחזור כירורגי', description: `שומרים ${surgicalAnalysis.goldenAssets.length} מסלולים זולים`, icon: '🎯' };
    } else if (surgicalAnalysis.toxicTracks.length > 0) {
      strategy = { type: 'FULL', title: '💰 מחזור מלא', description: 'כל המסלולים יקרים', icon: '🔥' };
    }
    if (strategy.type === 'NO_REFINANCE' && netSavings > 10000) {
      strategy = { type: 'REFINANCE_RECOMMENDED', title: '💰 מחזור מומלץ', description: `חיסכון נטו ₪${netSavings.toLocaleString()} — כולל ביטול נזק מדד`, icon: '💰' };
    }

    // ━━━ BORROWER NAMES ━━━
    const borrowersNames = [];
    if (extractionResult.borrower_1) borrowersNames.push(`${extractionResult.borrower_1.first_name || ''} ${extractionResult.borrower_1.last_name || ''}`.trim());
    if (extractionResult.borrower_2) borrowersNames.push(`${extractionResult.borrower_2.first_name || ''} ${extractionResult.borrower_2.last_name || ''}`.trim());

    // ━━━ EFFECTIVE RATE ━━━
    let effectiveRateOld = extractionResult.average_interest_rate || 0;
    if (allTracks.length > 0) {
      const totalBal = allTracks.reduce((s, t) => s + (t.remaining_balance || 0), 0);
      if (totalBal > 0) {
        effectiveRateOld = allTracks.reduce((s, t) => s + (isTrackCPILinked(t) ? t.interest_rate + EXPECTED_ANNUAL_INFLATION : t.interest_rate) * (t.remaining_balance || 0), 0) / totalBal;
      }
    }

    // ━━━ CONCLUSION ━━━
    const totalIndexDamage = totalIndexDamageLifetime; // Lifetime, לא 5 שנים
    const isSurgical = strategy.type === 'SURGICAL';

    // ━━━ CONCLUSION — מחושב אחרי שיש לנו את netSavings הסופי (כולל חוק 3) ━━━
    let conclusionText = '';
    if (arrearsDebt > 0) conclusionText = `⚠️ זוהה פיגור במשכנתא בסך ₪${arrearsDebt.toLocaleString()}. מדובר בתיק הצלה — מחזור המשכנתא נועד להסדיר את החוב ולהציל את הנכס.\n\n`;

    // ━━━ CONCLUSION — כל המספרים נשאבים מ-FINAL_NET בלבד ━━━
    if (FINAL_NET > 0) {
      conclusionText += `לאחר ניתוח מעמיק של יתרת הסילוק, זיהינו פוטנציאל חיסכון כלכלי נטו של ₪${FINAL_NET.toLocaleString()} לאורך תקופת ההלוואה`;
      if (totalIndexDamage > 0) {
        conclusionText += ` (כולל ₪${totalIndexDamage.toLocaleString()} מגן מדד Lifetime — ביטול הצמדה מלאה)`;
      }
      if (isSurgical && savingsResult.monthlySavings >= 200) {
        conclusionText += `. חיסכון חודשי מהמחזור הכירורגי: ₪${savingsResult.monthlySavings.toLocaleString()}`;
      } else if (overallMonthlySavings > 0) {
        conclusionText += `. החיסכון החודשי הצפוי עומד על ₪${overallMonthlySavings.toLocaleString()}`;
      } else if (overallMonthlySavings < 0) {
        conclusionText += `. ההחזר החודשי עולה ב-₪${Math.abs(overallMonthlySavings).toLocaleString()}, אך החיסכון הכולל נובע מביטול ההצמדה למדד`;
      }
      conclusionText += `.\n\n`;
    } else {
      conclusionText += `לאחר ניתוח מעמיק, המשכנתא הנוכחית שלך זולה יותר מהמחזור המוצע בתנאי השוק הנוכחיים. `;
      conclusionText += `ריבית המחזור (${parseFloat(avgNewRate.toFixed(2))}%) גבוהה מהריבית האפקטיבית הקיימת, ולכן עלות המחזור תעמוד על ₪${Math.abs(FINAL_NET).toLocaleString()} יותר לאורך התקופה.\n\n`;
    }
    if (totalIndexDamage > 0) conclusionText += `מסלולי ההצמדה הקיימים גורמים ל"נזק מדד" נוסף של כ-₪${totalIndexDamage.toLocaleString()} לאורך התקופה. מחזור למסלולים לא צמודים יבטל נזק זה לחלוטין.\n\n`;
    if (equityReleaseAnalysis?.monthlyCashFlowImprovement > 0) conclusionText += `באמצעות איחוד החובות, שיפור התזרים החודשי יעמוד על ₪${equityReleaseAnalysis.monthlyCashFlowImprovement.toLocaleString()} — שינוי משמעותי באיכות החיים.\n\n`;
    conclusionText += `אסטרטגיה מומלצת: ${strategy.title}. ${FINAL_NET > 50000 ? 'ממליצים בחום לפעול ולממש את החיסכון בהקדם.' : FINAL_NET > 10000 ? 'המחזור משתלם — כדאי לפעול.' : 'מומלץ לבדוק תנאים עדכניים מול הבנקים.'}`;

    // אף פעם לא להציג אימוג'י סכין בטקסט המסקנה, ללא קשר למקור
    conclusionText = conclusionText.replace(/🔪\s*/g, '');

    // ━━━ SANITIZE & RETURN ━━━
    const safeData = (data) => JSON.parse(JSON.stringify(data, (key, value) => {
      if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) return 0;
      return value;
    }));

    return jsonResponse(safeData({
      success: true,
      analysisEngine: { provider: 'google', model: GEMINI_MODEL },
      bankName: extractionResult.bank_name || 'לא זוהה',
      isFullReport: extractionResult.is_full_payoff_statement !== false,
      transactionType: transaction_type || 'refinance',
      statementDate,
      statementDateWarning,
      borrower_1: extractionResult.borrower_1 || null,
      borrower_2: extractionResult.borrower_2 || null,
      currentLoan: {
        remainingBalance: actualRemainingBalance,
        averageInterestRate: extractionResult.average_interest_rate,
        effectiveInterestRate: parseFloat(effectiveRateOld.toFixed(2)),
        monthlyPayment: extractionResult.monthly_payment || Math.round(existingMonthlyPayment),
        remainingMonths: weightedPeriodMonths,
        borrowers_names: borrowersNames,
        id_number: extractionResult.borrower_1?.id_number,
        borrower_2: extractionResult.borrower_2 || null,
        tracks: allTracks.map(t => {
          const c = classifyTrack(t);
          return { track_type: translateTrackType(t.track_type), remaining_balance: t.remaining_balance, interest_rate: t.interest_rate, remaining_months: t.remaining_months, effective_rate: c.effectiveRate, status: c.status, reason: c.reason, is_index_linked: t.is_index_linked };
        })
      },
      newLoan: {
        averageInterestRate: parseFloat(avgNewRate.toFixed(2)),
        monthlyPayment: Math.round(newMonthlyPaymentTotal),
        periodYears: Math.ceil(weightedPeriodMonths / 12)
      },
      savings: {
        actualRemainingBalance,
        newPrincipalWithFees: Math.round(totalNewPrincipal),
        arrearsDebt: arrearsDebt > 0 ? arrearsDebt : undefined,
        monthlySavings: overallMonthlySavings,
        netSavings,
        refinanceCost: totalCost,
        earlyRepaymentFee,
        feeExemptionReason,
        feeWarning,
        feeConfidence,
        bankFees,
        breakEvenMonths: savingsResult.monthlySavings > 0 ? Math.ceil(totalCost / Math.max(savingsResult.monthlySavings, 1)) : 0,
        isWorthwhile: savingsResult.isWorthwhile,
        newAverageRate: parseFloat(avgNewRate.toFixed(2)),
        newMonthlyPayment: Math.round(newMonthlyPaymentTotal),
        sensitivityAnalysis,
        indexDamageAlerts,
        equityReleaseAnalysis,
        inflationUsed: EXPECTED_ANNUAL_INFLATION
      },
      // partialRefinanceSavings — netSavings = FINAL_NET (Single Source of Truth)
      partialRefinanceSavings: isSurgicalMode ? {
        toxicBalance: Math.round(surgicalBalance),
        monthlySavings: savingsResult.monthlySavings,
        netSavings: FINAL_NET,
        fees: Math.round(earlyRepaymentFee + bankFees),
        breakEvenMonths: savingsResult.monthlySavings > 0 ? Math.ceil((earlyRepaymentFee + bankFees) / savingsResult.monthlySavings) : 0,
        isWorthwhile: FINAL_NET > 20000
      } : null,
      surgicalAnalysis: {
        goldenCount: surgicalAnalysis.goldenAssets.length,
        toxicCount: surgicalAnalysis.toxicTracks.length,
        strategy,
        goldenAssets: surgicalAnalysis.goldenAssets.map(t => ({ track_type: translateTrackType(t.track_type), interest_rate: t.interest_rate, remaining_balance: t.remaining_balance })),
        toxicTracks: surgicalAnalysis.toxicTracks.map(t => ({ track_type: translateTrackType(t.track_type), interest_rate: t.interest_rate, remaining_balance: t.remaining_balance }))
      },
      // Generic mixes are intentionally no longer returned. They are produced
      // on demand for the selected strategy by calculate-refinance-mixes.
      mixes: [],
      mixCalculationContext,
      conclusionText,
      newRates: { average_rates: CURRENT_MARKET_RATES },
      bankReadyMetadata: { inflationAssumption: EXPECTED_ANNUAL_INFLATION, actualFeesUsed: earlyRepaymentFee, complianceChecked: true, feeConfidence },

      // ━━━ SNAPSHOT HEADER: LTV + PTI ━━━
      snapshotHeader: (() => {
        const propertyValue = extractionResult.estimated_property_value || 0;
        const ltv = propertyValue > 0 ? parseFloat(((actualRemainingBalance / propertyValue) * 100).toFixed(1)) : null;
        // PTI: monthly payment vs estimated household income
        // We don't have income here, but we return the payment so the frontend can display PTI if income is known
        return {
          propertyValue: propertyValue || null,
          ltv,
          ltvStatus: ltv ? (ltv < 45 ? 'excellent' : ltv < 60 ? 'good' : ltv < 70 ? 'acceptable' : 'high') : null,
          remainingBalance: actualRemainingBalance,
          currentMonthlyPayment: extractionResult.monthly_payment || Math.round(existingMonthlyPayment),
        };
      })(),

      // ━━━ DUAL STRATEGY: חיסכון (קיצור שנים) vs חמצן (הפחתת החזר) ━━━
      dualStrategy: (() => {
        const r = avgNewRate / 100 / 12;
        const currentMonthly = extractionResult.monthly_payment || Math.round(existingMonthlyPayment);

        // ━━━ SURGICAL vs FULL: הגדר principal ומסלולים לפי מצב ━━━
        const tracksForComparison = isSurgicalMode ? nonGreenTracksForSavings : allTracks;
        const surgicalPrincipal = isSurgicalMode ? surgicalBalance + earlyRepaymentFee + bankFees : actualRemainingBalance + earlyRepaymentFee + bankFees;

        // ━━━ GOLDEN MONTHLY: החזר חודשי של המסלולים שנשמרים (לתיק כירורגי) ━━━
        // זה נדרש כדי להציג ללקוח את ה"החזר הכולל" האמיתי לאחר המחזור
        const goldenMonthly = isSurgicalMode
          ? goldenTracksForSavings.reduce((s, t) => {
              const rr = t.interest_rate / 100 / 12;
              const n = t.remaining_months || 0;
              const b = t.remaining_balance || 0;
              return (rr > 0 && n > 0 && b > 0) ? s + b * (rr * Math.pow(1+rr, n)) / (Math.pow(1+rr, n) - 1) : s;
            }, 0)
          : 0;

        // ═══ OLD COST LIFETIME: עלות המסלולים שמוחזרים — Lifetime מלא כולל מדד ═══
        // זה הבסיס הקריטי — חייב לרוץ על כל חודשי המסלול (לא רק 60!)
        let oldCostLifetime = 0;
        tracksForComparison.forEach(track => {
          const linked = isTrackCPILinked(track);
          const annualRate = track.interest_rate || 0;
          const balance = track.remaining_balance || 0;
          const rTrack = annualRate / 100 / 12;
          const months = track.remaining_months || weightedPeriodMonths; // FULL remaining life!
          if (balance <= 0 || months <= 0) return;
          if (linked) {
            oldCostLifetime += calcLinkedCost(balance, annualRate, months); // כולל הצמדה Lifetime
          } else {
            const pmt = balance * (rTrack * Math.pow(1+rTrack, months)) / (Math.pow(1+rTrack, months) - 1);
            oldCostLifetime += pmt * months;
          }
        });
        console.log(`📐 DualStrategy oldCostLifetime=₪${Math.round(oldCostLifetime).toLocaleString()} across ${tracksForComparison.length} tracks (surgical=${isSurgicalMode})`);

        // ━━━ STRATEGY A: MAX SAVINGS — Avoided Payments (חוק 1) ━━━
        // המנגנון: מחפש תקופה קצרה ביותר שבה ההחזר ≤ 115% מהנוכחי
        // netSavings = oldCostLifetime - (תשלומים בפועל בתקופה החדשה) - עמלות
        // הרווח הגדול = החודשים שנחסכו בסוף (Avoided Payments)
        const refCurrentMonthly = isSurgicalMode
          ? nonGreenTracksForSavings.reduce((s, t) => {
              const rr = t.interest_rate / 100 / 12;
              const n = t.remaining_months || 0;
              const b = t.remaining_balance || 0;
              return (rr > 0 && n > 0 && b > 0) ? s + b * (rr * Math.pow(1+rr, n)) / (Math.pow(1+rr, n) - 1) : s;
            }, 0)
          : currentMonthly;
        const referenceMonths = isSurgicalMode ? (surgicalAvgMonths || weightedPeriodMonths) : weightedPeriodMonths;
        const referenceYears = Math.ceil(referenceMonths / 12);
        let strategySavingsYears = referenceYears; // fallback = תקופה מלאה
        for (let y = 10; y <= referenceYears; y++) {
          const m = y * 12;
          const pmt = surgicalPrincipal * (r * Math.pow(1+r, m)) / (Math.pow(1+r, m) - 1);
          if (pmt <= refCurrentMonthly * 1.15) { strategySavingsYears = y; break; }
        }
        const strategySavingsMonths = strategySavingsYears * 12;
        const strategyAMonthlyPayment = Math.round(surgicalPrincipal * (r * Math.pow(1+r, strategySavingsMonths)) / (Math.pow(1+r, strategySavingsMonths) - 1));
        // ══ Avoided Payments חוק 1: המסלולים שנמחקים = oldCostLifetime - עלות חדשה קצרה - עמלות
        const strategyATotalPaid = strategyAMonthlyPayment * strategySavingsMonths;
        const savingsNetSavings = Math.round(oldCostLifetime - strategyATotalPaid - totalCost);
        const yearsShortened = referenceYears - strategySavingsYears;
        const savingsMonthlySavings = Math.round(currentMonthly - strategyAMonthlyPayment);
        const displaySavingsMonthlyPayment = strategyAMonthlyPayment;
        const displaySavingsYears = strategySavingsYears;

        console.log(`📐 StrategyA: oldLifetime=₪${Math.round(oldCostLifetime).toLocaleString()} | newTotal=₪${strategyATotalPaid.toLocaleString()} | fees=₪${totalCost} | NET=₪${savingsNetSavings.toLocaleString()} | yearsShortened=${yearsShortened}`);

        // ━━━ STRATEGY B: MAX OXYGEN — הפחתת החזר (30 שנה) ━━━
        // oldCostForOxygenPeriod: עלות ישנה לאותה תקופה ארוכה — השוואה הוגנת
        const oxygenYears = Math.min(30, maxAllowedYears);
        const oxygenMonths = oxygenYears * 12;
        const oxygenMonthlyPayment = Math.round(surgicalPrincipal * (r * Math.pow(1+r, oxygenMonths)) / (Math.pow(1+r, oxygenMonths) - 1));
        const oxygenTotalPaid = oxygenMonthlyPayment * oxygenMonths;
        let oldCostForOxygenPeriod = 0;
        tracksForComparison.forEach(track => {
          const linked = isTrackCPILinked(track);
          const annualRate = track.interest_rate || 0;
          const balance = track.remaining_balance || 0;
          const rTrack = annualRate / 100 / 12;
          const trackMonths = track.remaining_months || weightedPeriodMonths;
          if (balance <= 0 || trackMonths <= 0) return;
          const effectiveMonths = Math.max(trackMonths, oxygenMonths);
          if (linked) {
            oldCostForOxygenPeriod += calcLinkedCost(balance, annualRate, effectiveMonths);
          } else {
            const pmt = balance * (rTrack * Math.pow(1+rTrack, effectiveMonths)) / (Math.pow(1+rTrack, effectiveMonths) - 1);
            oldCostForOxygenPeriod += pmt * effectiveMonths;
          }
        });
        const oxygenNetSavings = Math.round(oldCostForOxygenPeriod - oxygenTotalPaid - totalCost);

        // ━━━ MARKET RATE FLOOR VALIDATION ━━━
        // בתיק כירורגי: ה-EMI החדש חייב לכסות לפחות את הריבית השוק על surgicalPrincipal.
        // אם oxygenMonthlyPayment נמוך מהאפשרי מתמטית (באג חישוב), נחשב מחדש לפי ריבית השוק.
        const marketRateFloorMonthly = (() => {
          if (!isSurgicalMode || surgicalPrincipal <= 0) return 0;
          const floorRate = Math.min(avgPrime, avgFixedUnlinked, avgVariableUnlinked) / 100 / 12;
          const n = oxygenMonths;
          return surgicalPrincipal * (floorRate * Math.pow(1 + floorRate, n)) / (Math.pow(1 + floorRate, n) - 1);
        })();
        const validatedOxygenMonthly = Math.max(oxygenMonthlyPayment, marketRateFloorMonthly);
        console.log(`🔍 OxygenFloor: calculated=₪${Math.round(oxygenMonthlyPayment).toLocaleString()} | floor=₪${Math.round(marketRateFloorMonthly).toLocaleString()} | used=₪${Math.round(validatedOxygenMonthly).toLocaleString()}`);

        const monthlyRelief = currentMonthly - oxygenMonthlyPayment;

        console.log(`📊 DualStrategy: Strategy A net=₪${savingsNetSavings.toLocaleString()} | Strategy B net=₪${oxygenNetSavings.toLocaleString()}`);

        // בתיק כירורגי: ה"החזר הכולל" = תשלום מסלולים חדשים (מאומת ≥ רצפת שוק) + תשלום מסלולי הזהב שנשמרו
        const strategyATotalMonthly = Math.round(strategyAMonthlyPayment + goldenMonthly);
        const strategyBTotalMonthly = Math.round(validatedOxygenMonthly + goldenMonthly);
        const strategyADeltaFromCurrent = strategyATotalMonthly - currentMonthly;
        const strategyBDeltaFromCurrent = strategyBTotalMonthly - currentMonthly;
        const strategyBReliefTotal = Math.max(0, currentMonthly - strategyBTotalMonthly);
        console.log(`📊 Final totals: strategyA=₪${strategyATotalMonthly.toLocaleString()} | strategyB=₪${strategyBTotalMonthly.toLocaleString()} | current=₪${currentMonthly.toLocaleString()} | golden=₪${Math.round(goldenMonthly).toLocaleString()}`);

        return {
          strategyA: {
            label: 'מקסימום חיסכון (קיצור שנים)',
            icon: '🏆',
            monthlyPayment: strategyATotalMonthly,
            monthlyPaymentNewOnly: strategyAMonthlyPayment,
            periodYears: displaySavingsYears,
            yearsShortened: Math.max(0, yearsShortened),
            netSavings: savingsNetSavings,
            monthlySavings: savingsMonthlySavings,
            monthlyDelta: strategyADeltaFromCurrent,
            suitedFor: 'מושלם למי שרוצה לגמור עם החוב מהר ובזול'
          },
          strategyB: {
            label: 'מקסימום חמצן (הפחתת החזר)',
            icon: '🫁',
            monthlyPayment: strategyBTotalMonthly,
            monthlyPaymentNewOnly: Math.round(validatedOxygenMonthly),
            periodYears: oxygenYears,
            monthlyRelief: strategyBReliefTotal,
            netSavings: oxygenNetSavings,
            monthlyDelta: strategyBDeltaFromCurrent,
            suitedFor: 'מושלם למי שרוצה לשפר תזרים חודשי'
          },
          goldenMonthly: Math.round(goldenMonthly),
          currentMonthly
        };
      })()
    }));

  } catch (error) {
    console.error('Error:', error);
    const geminiError = getGeminiErrorDetails(error);
    if (geminiError.isTransient) {
      return jsonResponse({
        success: false,
        error: 'שירות הניתוח עמוס כרגע. נסה שוב בעוד מספר רגעים.',
        errorCode: 'MODEL_BUSY',
      }, { status: geminiError.status || 503 });
    }

    // A contract error means OUR request was wrong, not the borrower's upload.
    // Telling them to rescan a perfectly good statement is what hid the
    // `responseFormat` bug for as long as it did, so keep the two apart and log
    // the detail server-side.
    if (geminiError.isContractError) {
      console.error('Gemini contract violation — this is a bug in the analyzer, not the document');
      return jsonResponse({
        success: false,
        error: 'תקלה זמנית בשירות הניתוח. אנא נסה שוב, ואם התקלה חוזרת — צור איתנו קשר.',
        errorCode: 'ANALYZER_CONTRACT_ERROR',
      }, { status: 200 });
    }

    // Return 200 with success:false for genuine document-readability failures
    // so the frontend can show the user-friendly message. Matched narrowly:
    // the old check keyed on the bare substring 'JSON', which swept up internal
    // parse failures too.
    const isDocumentError = /unreadable|unsupported|corrupt|could not (?:read|parse) (?:the )?(?:file|document|pdf)/i
      .test(geminiError.message);
    const userMessage = isDocumentError
      ? 'שגיאה בניתוח המסמך. ודא שהקובץ הוא PDF או תמונה ברורים וקריאים ונסה שוב.'
      : (geminiError.message || 'שגיאה בניתוח. נסה שוב.');
    return jsonResponse({ success: false, error: userMessage }, { status: 200 });
  }
});
