import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { rateLimitCheck } from '@/lib/redis';
import { requireAuth } from '@/lib/auth-guard';

// ────────────────────────────────────────────────────────────────────────────
// /api/web-search
// Real web search + LLM synthesis for a single match.
// Returns: { summary, injuries, team_news, h2h, prediction_context, score_predictions, sources, query }
// Cache: in-memory, 10 min TTL (avoids re-searching the same match).
// ────────────────────────────────────────────────────────────────────────────

// Force Node.js runtime — the z-ai-web-dev-sdk uses fs/promises to load config.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CacheEntry {
  data: any;
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 600_000; // 10 min
const CACHE_MAX_ENTRIES = 50; // LRU eviction limit (prevents memory DoS)

// ────────────────────────────────────────────────────────────────────────────
// Rate limiting — stricter than /api/matchs because each request triggers an
// LLM call (real money cost) + external web search. 5 req/min/IP is plenty for
// a single user clicking "Analyse web" on different matches.
// Délégué à src/lib/redis.ts (Redis si configuré, in-memory sinon).
// ────────────────────────────────────────────────────────────────────────────
const WEB_SEARCH_RATE_LIMIT_MAX = 5; // 5 searches per minute per IP

function getClientIP(request: NextRequest): string {
  // NOTE: Behind Caddy, X-Forwarded-For is set by the proxy and trusted.
  // A direct attacker cannot spoof it because Caddy overwrites the header.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;
  return 'unknown';
}

async function checkWebSearchRateLimit(ip: string): Promise<{ allowed: boolean; resetAt: number }> {
  const result = await rateLimitCheck(`websearch:${ip}`, WEB_SEARCH_RATE_LIMIT_MAX, 60);
  return { allowed: result.allowed, resetAt: result.resetAt };
}

function setCache(key: string, data: any): void {
  // BUG-19 FIX : vrai LRU. Map conserve l'ordre d'INSERTION, donc pour maintenir
  // l'ordre d'accès il faut delete + re-set (déplace la clé en fin). On évince AUSSI
  // avant d'insérer pour ne jamais dépasser le cap sous concurrence (avant : check
  // après set → pic à MAX+1, et éviction = première insertion = FIFO, pas LRU).
  cache.delete(key);
  cache.set(key, { data, timestamp: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

// Sanitize a string input: strip HTML/injection chars + cap length.
// Used for `home`, `away`, `competition` — prevents prompt injection + cache-key flooding.
const MAX_FIELD_LEN = 100;
function sanitizeInput(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  // Remove HTML/JS injection chars and template-literal markers.
  const cleaned = s.replace(/[<>"'`{}\\\[\]]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_FIELD_LEN);
}

// Wrap a promise with a timeout — rejects after `ms`. Bounds SDK calls with no built-in timeout.
function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

interface MatchParams {
  home: string;
  away: string;
  competition?: string;
  date?: string;
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  host?: string;
  date?: string;
}

function buildQuery(p: MatchParams): string {
  // Build a search query that targets recent news + prediction sites for this match.
  const parts = [
    p.home,
    'vs',
    p.away,
    'prediction',
    'score prediction',
    'team news',
    'injuries',
    'lineup',
    'preview',
  ];
  if (p.competition) parts.push(p.competition);
  return parts.join(' ');
}

// ────────────────────────────────────────────────────────────────────────────
// buildScorerQuery — génère UNE requête ciblée pour trouver les prédictions
// de BUTEURS publiées par les sites d'experts (Forebet, PredictZ, SportyTrader,
// Windrawwin, Forebet, etc.).
//
// Contrairement à buildQuery (générique), cette requête inclut :
//  - Les noms des sites d'experts (site:forebet.com, "PredictZ", etc.)
//  - Les mots-clés buteurs ("goalscorer", "first goalscorer", "anytime scorer",
//    "top scorer", "who will score")
//  - La compétition pour cibler le bon tournoi (top scorer WC, Ligue 1, etc.)
// ────────────────────────────────────────────────────────────────────────────
function buildScorerQuery(p: MatchParams): string {
  const home = p.home || '';
  const away = p.away || '';
  const comp = p.competition || '';

  // Requête principale : combine match + sites experts + mots-clés buteurs
  const matchPart = [home, 'vs', away].filter(Boolean).join(' ');
  const expertSites = [
    'forebet',
    'predictz',
    'sportytrader',
    'windrawwin',
    'oddsportal',
    'bettingexpert',
  ].join(' OR ');
  const scorerKeywords = [
    'goalscorer',
    'first goalscorer',
    'anytime goalscorer',
    'who will score',
    'top scorer',
    'buteur',
  ].join(' OR ');

  const parts = [
    matchPart,
    `(${expertSites})`,
    `(${scorerKeywords})`,
    'prediction',
  ];
  if (comp) parts.push(comp);
  return parts.join(' ');
}

// ────────────────────────────────────────────────────────────────────────────
// buildTopScorerQuery — requête SECONDAIRE qui cherche le TOP SCORER du tournoi
// (indépendamment du match). Crucial pour les coupes : si Mbappé a 8 buts en WC,
// il doit ressortir même si aucun site ne parle de "France vs Espagne goalscorer".
// ────────────────────────────────────────────────────────────────────────────
function buildTopScorerQuery(p: MatchParams): string {
  const comp = p.competition || '';
  if (!comp) return '';
  return [
    comp,
    'top scorer',
    'golden boot',
    'capocannoniere',
    'meilleur buteur',
    '2026',
  ].join(' ');
}

// Empty score_predictions object — returned when no external prediction site
// is found in the search snippets, or when the LLM call fails. Shared across
// the empty / fallback / error paths to keep the response shape consistent.
const EMPTY_SCORE_PREDICTIONS = {
  consensus: '',
  confidence: 'low' as const,
  sources_summary: 'Aucune prédiction externe trouvée',
  alternative_scores: [] as string[],
};

// Empty goalscorers — same pattern. `top_scorer === ''` is the sentinel the UI uses to hide the "Buteur probable" section.
const EMPTY_GOALSCORERS = { top_scorer: '', top_scorer_team: 'home' as 'home' | 'away', confidence: 'low' as 'high' | 'medium' | 'low', alternative_scorers: [] as string[], reasoning: '', expert_source: '' };

// ────────────────────────────────────────────────────────────────────────────
// Strategy 1 (preferred): SDK web_search function via z-ai-web-dev-sdk.
// The SDK calls POST {baseUrl}/functions/invoke and unwraps `result.result`,
// which is a SearchFunctionResultItem[] (url, name, snippet, host_name, date).
// ────────────────────────────────────────────────────────────────────────────
async function sdkWebSearch(
  query: string,
  num: number = 8,
): Promise<SearchResult[]> {
  const zai = await ZAI.create();
  // Bound the SDK call — without this a hanging upstream could keep the
  // request open indefinitely and amplify DoS.
  const resp = (await withTimeout(
    zai.functions.invoke('web_search', {
      query,
      num,
      recency_days: 30,
    }) as Promise<any>,
    12_000,
    'web_search',
  )) as any;

  // Defensive: handle many possible shapes.
  const list: any[] = Array.isArray(resp)
    ? resp
    : Array.isArray(resp?.results)
      ? resp.results
      : Array.isArray(resp?.data)
        ? resp.data
        : [];

  return list.slice(0, num).map((r: any, i: number) => ({
    title: r.title || r.name || `Result ${i + 1}`,
    snippet: r.snippet || r.description || r.summary || r.content || '',
    url: r.url || r.link || r.href || '',
    host: r.host_name || r.host || '',
    date: r.date || '',
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Strategy 2 (fallback): direct DuckDuckGo lite HTML scrape (no API key).
// Lite endpoint returns a simple HTML table that is easy to regex-parse.
// ────────────────────────────────────────────────────────────────────────────
async function duckDuckGoSearch(
  query: string,
  num: number = 8,
): Promise<SearchResult[]> {
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    // lite.duckduckgo.com uses <a class="result-link" href="...">title</a>
    // followed by a <td class="result-snippet">...</td>.
    const linkRegex =
      /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex =
      /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

    const links: Array<{ url: string; title: string }> = [];
    const snippets: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null) {
      const linkUrl = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      // Skip ddg redirect links / ads
      if (linkUrl && !linkUrl.startsWith('//duckduckgo.com')) {
        links.push({ url: linkUrl, title });
      }
    }
    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    const results: SearchResult[] = [];
    for (let i = 0; i < Math.min(num, links.length); i++) {
      results.push({
        title: links[i].title || `Result ${i + 1}`,
        snippet: snippets[i] || '',
        url: links[i].url,
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function runWebSearch(query: string, num: number = 8): Promise<{
  results: SearchResult[];
  source: 'sdk' | 'duckduckgo' | 'none';
}> {
  // Try SDK first.
  try {
    const sdkResults = await sdkWebSearch(query, num);
    if (sdkResults.length > 0) {
      return { results: sdkResults, source: 'sdk' };
    }
  } catch (err) {
    console.error('[web-search] SDK search failed:', err);
  }

  // Fallback: DuckDuckGo direct.
  try {
    const ddgResults = await duckDuckGoSearch(query, num);
    if (ddgResults.length > 0) {
      return { results: ddgResults, source: 'duckduckgo' };
    }
  } catch (err) {
    console.error('[web-search] DuckDuckGo fallback failed:', err);
  }

  return { results: [], source: 'none' };
}

// ────────────────────────────────────────────────────────────────────────────
// runMultiSearch — lance EN PARALLÈLE plusieurs recherches ciblées et merge
// les résultats. Utilisé pour la recherche de buteurs :
//  1. Recherche principale (contexte du match, news, blessures)
//  2. Recherche spécifique buteurs (Forebet, PredictZ, SportyTrader...)
//  3. Recherche top scorer du tournoi (golden boot, capocannoniere...)
//
// Chaque recherche utilise son propre fallback SDK → DuckDuckGo. Les résultats
// sont dédupliqués par URL pour éviter de nourrir le LLM avec des snippets
// redondants.
// ────────────────────────────────────────────────────────────────────────────
async function runMultiSearch(
  queries: { label: string; query: string; num: number }[],
): Promise<{
  main: SearchResult[];
  scorer: SearchResult[];
  topScorer: SearchResult[];
  source: 'sdk' | 'duckduckgo' | 'none';
}> {
  // Lance toutes les recherches en parallèle (chacune a son propre fallback SDK → DDG)
  const searchPromises = queries
    .filter((q) => q.query.trim().length > 0)
    .map(async (q) => {
      const { results, source } = await runWebSearch(q.query, q.num);
      return { label: q.label, results, source };
    });

  const allResults = await Promise.all(searchPromises);

  // Déduplication par URL (un même site peut sortir dans plusieurs requêtes)
  const seenUrls = new Set<string>();
  const dedup = (list: SearchResult[]): SearchResult[] => {
    const out: SearchResult[] = [];
    for (const r of list) {
      const key = r.url || r.title;
      if (key && !seenUrls.has(key)) {
        seenUrls.add(key);
        out.push(r);
      }
    }
    return out;
  };

  const main = allResults.find((r) => r.label === 'main')?.results || [];
  const scorer = dedup(allResults.find((r) => r.label === 'scorer')?.results || []);
  const topScorer = dedup(allResults.find((r) => r.label === 'topScorer')?.results || []);

  // Détermine la source globale (SDK si au moins une recherche SDK a marché)
  const anySdk = allResults.some((r) => r.source === 'sdk' && r.results.length > 0);
  const anyDdg = allResults.some((r) => r.source === 'duckduckgo' && r.results.length > 0);
  const source: 'sdk' | 'duckduckgo' | 'none' = anySdk ? 'sdk' : anyDdg ? 'duckduckgo' : 'none';

  return { main, scorer, topScorer, source };
}

// ────────────────────────────────────────────────────────────────────────────
// BUG #9 FIX : computeAdjustedPronostic
// Ajuste les probas 1X2 en fonction des blessures détectées par le LLM.
//
// LOGIQUE :
// - Si odds_source ∈ {draftkings, api_football, football_data} : cotes RÉELLES du
//   marché. Les bookmakers ont déjà pricé les blessures → NE PAS ajuster (sinon
//   double comptage). On retourne { applied: false, reason: 'real_odds' }.
// - Si odds_source ∈ {espn_predictor, form_based} : cotes ESTIMÉES par notre
//   modèle. Les blessures apportent une vraie info → on ajuste les probas.
//
// AJUSTEMENT (par blessure) :
//   - impact 'high'   → -8% sur l'équipe touchée, redistribué sur les 2 autres
//   - impact 'medium' → -4% sur l'équipe touchée, redistribué sur les 2 autres
//   - impact 'low'    → -1% sur l'équipe touchée, redistribué sur les 2 autres
//
// La redistribution est proportionnelle aux probas existantes des 2 autres
// issues (ex: si p2 >> pN, l'ajustement va majoritairement à p2).
//
// On borne aussi l'ajustement total à ±15% par équipe (sinon un match avec 5
// blessures 'high' deviendrait absurde).
//
// Retourne null si basePronostic est null, ou si rien à ajuster (pas de blessures).
// ────────────────────────────────────────────────────────────────────────────
interface Injury {
  team: string;   // 'home' | 'away'
  player: string;
  reason: string;
  impact: string; // 'high' | 'medium' | 'low'
}
interface BasePronostic {
  probas_1x2: {
    prob_1: number;
    prob_N: number;
    prob_2: number;
  };
}
interface AdjustedPronostic {
  applied: boolean;
  reason: string; // 'real_odds' | 'no_injuries' | 'no_base_pronostic' | 'estimated_odds'
  probas_1x2?: {
    prob_1: number;
    prob_N: number;
    prob_2: number;
  };
  original_probas_1x2?: {
    prob_1: number;
    prob_N: number;
    prob_2: number;
  };
  adjustments?: Array<{
    team: 'home' | 'away';
    player: string;
    impact: string;
    delta: number; // négatif = baisse de proba pour cette équipe
  }>;
  summary?: string;
}

function computeAdjustedPronostic(
  basePronostic: BasePronostic | null,
  oddsSource: string | undefined,
  injuries: Injury[],
  homeName: string,
  awayName: string,
): AdjustedPronostic | null {
  if (!basePronostic) {
    return null;
  }

  const original = basePronostic.probas_1x2;
  // Sécurité : probas valides.
  if (
    typeof original.prob_1 !== 'number' ||
    typeof original.prob_N !== 'number' ||
    typeof original.prob_2 !== 'number' ||
    original.prob_1 + original.prob_N + original.prob_2 < 0.95 ||
    original.prob_1 + original.prob_N + original.prob_2 > 1.05
  ) {
    return { applied: false, reason: 'no_base_pronostic' };
  }

  // Cotes réelles → pas d'ajustement (blessures déjà pricées).
  const realOddsSources = ['draftkings', 'api_football', 'football_data'];
  if (oddsSource && realOddsSources.includes(oddsSource)) {
    return {
      applied: false,
      reason: 'real_odds',
      summary: `Cotes réelles (${oddsSource}) — blessures déjà pricées par le marché, pas d'ajustement.`,
    };
  }

  // Pas de blessures → rien à ajuster.
  if (!injuries || injuries.length === 0) {
    return { applied: false, reason: 'no_injuries' };
  }

  // Cotes estimées + blessures détectées → on ajuste.
  let p1 = original.prob_1;
  let pN = original.prob_N;
  let p2 = original.prob_2;
  const adjustments: AdjustedPronostic['adjustments'] = [];
  let homeDeltaTotal = 0;
  let awayDeltaTotal = 0;

  for (const inj of injuries) {
    // Impact → magnitude de l'ajustement (négatif car on réduit la proba).
    let magnitude = 0;
    if (inj.impact?.toLowerCase() === 'high') magnitude = -0.08;
    else if (inj.impact?.toLowerCase() === 'medium') magnitude = -0.04;
    else if (inj.impact?.toLowerCase() === 'low') magnitude = -0.01;
    else continue; // impact inconnu → ignore

    if (inj.team === 'home') {
      // Cap à -15% total pour home (évite l'absurde).
      if (homeDeltaTotal <= -0.15) continue;
      magnitude = Math.max(magnitude, -0.15 - homeDeltaTotal);
      if (magnitude >= 0) continue;

      // Redistribue proportionnellement sur pN et p2.
      const redistrib = -magnitude; // positif
      const othersSum = pN + p2;
      const pNDelta = othersSum > 0 ? redistrib * (pN / othersSum) : redistrib / 2;
      const p2Delta = redistrib - pNDelta;

      p1 = Math.max(0.05, p1 + magnitude);
      pN = pN + pNDelta;
      p2 = p2 + p2Delta;
      homeDeltaTotal += magnitude;

      adjustments.push({ team: 'home', player: inj.player, impact: inj.impact, delta: magnitude });
    } else if (inj.team === 'away') {
      // Cap à -15% total pour away.
      if (awayDeltaTotal <= -0.15) continue;
      magnitude = Math.max(magnitude, -0.15 - awayDeltaTotal);
      if (magnitude >= 0) continue;

      const redistrib = -magnitude;
      const othersSum = p1 + pN;
      const p1Delta = othersSum > 0 ? redistrib * (p1 / othersSum) : redistrib / 2;
      const pNDelta = redistrib - p1Delta;

      p2 = Math.max(0.05, p2 + magnitude);
      p1 = p1 + p1Delta;
      pN = pN + pNDelta;
      awayDeltaTotal += magnitude;

      adjustments.push({ team: 'away', player: inj.player, impact: inj.impact, delta: magnitude });
    }
  }

  // Renormalisation (sécurité — la somme doit rester = 1).
  const total = p1 + pN + p2;
  p1 /= total; pN /= total; p2 /= total;

  // Résumé human-readable.
  const homeInj = adjustments.filter(a => a.team === 'home');
  const awayInj = adjustments.filter(a => a.team === 'away');
  const parts: string[] = [];
  if (homeInj.length > 0) {
    parts.push(`${homeName}: ${(homeDeltaTotal * 100).toFixed(1)}% (${homeInj.length} blessure${homeInj.length > 1 ? 's' : ''})`);
  }
  if (awayInj.length > 0) {
    parts.push(`${awayName}: ${(awayDeltaTotal * 100).toFixed(1)}% (${awayInj.length} blessure${awayInj.length > 1 ? 's' : ''})`);
  }
  const summary = `Pronostic ajusté pour blessures — ${parts.join(' · ')}`;

  return {
    applied: true,
    reason: 'estimated_odds',
    probas_1x2: {
      prob_1: Math.round(p1 * 10000) / 10000,
      prob_N: Math.round(pN * 10000) / 10000,
      prob_2: Math.round(p2 * 10000) / 10000,
    },
    original_probas_1x2: {
      prob_1: original.prob_1,
      prob_N: original.prob_N,
      prob_2: original.prob_2,
    },
    adjustments,
    summary,
  };
}

export async function POST(request: NextRequest) {
  // === AUTHENTIFICATION (obligatoire) : se connecter d'abord ===
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  // === RATE LIMITING (stricter — LLM costs real money) ===
  const clientIP = getClientIP(request);
  const rateLimitResult = await checkWebSearchRateLimit(clientIP);
  if (!rateLimitResult.allowed) {
    const retryAfter = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Trop de recherches. Réessayez dans ' + retryAfter + 's.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  try {
    const rawBody = await request.json();
    // === INPUT VALIDATION + SANITIZATION ===
    // Validate types first (defend against non-string JSON values).
    const home = sanitizeInput(rawBody?.home);
    const away = sanitizeInput(rawBody?.away);
    const competition = sanitizeInput(rawBody?.competition) || undefined;
    const date = sanitizeInput(rawBody?.date) || undefined;

    // BUG #9 FIX : accepter le pronostic de base + odds_source pour calculer
    // un pronostic ajusté en fonction des blessures détectées par le LLM.
    // - Si odds_source est 'draftkings' | 'api_football' | 'football_data' : cotes réelles,
    //   les blessures sont DÉJÀ pricées par le marché → on n'ajuste pas (sinon double comptage).
    // - Si odds_source est 'espn_predictor' | 'form_based' : cotes estimées, les blessures
    //   apportent une vraie info → on ajuste les probas.
    const basePronostic = rawBody?.base_pronostic;
    const oddsSource = sanitizeInput(rawBody?.odds_source) || undefined;
    const hasValidBasePronostic =
      basePronostic &&
      typeof basePronostic === 'object' &&
      basePronostic.probas_1x2 &&
      typeof basePronostic.probas_1x2.prob_1 === 'number' &&
      typeof basePronostic.probas_1x2.prob_N === 'number' &&
      typeof basePronostic.probas_1x2.prob_2 === 'number';

    if (!home || !away) {
      return NextResponse.json(
        { error: 'Paramètres manquants ou invalides: home et away requis (chaînes ≤ 100 caractères)' },
        { status: 400 },
      );
    }

    // Cache lookup (10 min TTL).
    // BUG #9 FIX : inclure odds_source dans la clé de cache — un même match peut avoir
    // des ajustements différents selon que les cotes sont réelles ou estimées.
    const cacheKey = `${home}|${away}|${competition || ''}|${oddsSource || ''}|${hasValidBasePronostic ? 'adj' : 'noadj'}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      // BUG-19 FIX : touch LRU à la lecture (déplace la clé en fin d'ordre d'insertion).
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return NextResponse.json(cached.data, {
        headers: { 'X-Cache': 'HIT' },
      });
    }

    // Step 1: web search — lance EN PARALLÈLE 3 requêtes ciblées :
    //   - main      : contexte du match (news, blessures, lineups)
    //   - scorer    : prédictions de buteurs par les sites experts (Forebet, PredictZ…)
    //   - topScorer : top scorer du tournoi (golden boot, capocannoniere…)
    const matchParams = { home, away, competition, date };
    const query = buildQuery(matchParams);
    const scorerQuery = buildScorerQuery(matchParams);
    const topScorerQuery = buildTopScorerQuery(matchParams);

    const { main: mainResults, scorer: scorerResults, topScorer: topScorerResults, source } =
      await runMultiSearch([
        { label: 'main', query, num: 8 },
        { label: 'scorer', query: scorerQuery, num: 6 },
        { label: 'topScorer', query: topScorerQuery, num: 5 },
      ]);

    const searchResults = mainResults;
    const rawSnippets = mainResults
      .map((r) => `[${r.title}] ${r.snippet}`.trim())
      .filter((s) => s.length > 5)
      .join('\n\n');

    // Snippets SPÉCIFIQUES buteurs (Forebet, PredictZ, SportyTrader…) — nourrissent
    // la section "goalscorers" du LLM. Si aucun snippet buteur n'est trouvé, on
    // fallback sur les snippets principaux pour ne pas bloquer la synthèse.
    const scorerSnippets = (scorerResults.length > 0 ? scorerResults : topScorerResults)
      .map((r) => `[${r.title}] (${r.host || 'source'}) ${r.snippet}`.trim())
      .filter((s) => s.length > 5)
      .join('\n\n');
    const topScorerSnippets = topScorerResults
      .map((r) => `[${r.title}] (${r.host || 'source'}) ${r.snippet}`.trim())
      .filter((s) => s.length > 5)
      .join('\n\n');

    if (!rawSnippets && !scorerSnippets && !topScorerSnippets) {
      const emptyResult = {
        summary:
          'Aucune information récente trouvée pour ce match via le web.',
        injuries: [],
        team_news: [],
        h2h: '',
        prediction_context: '',
        score_predictions: { ...EMPTY_SCORE_PREDICTIONS },
        goalscorers: { ...EMPTY_GOALSCORERS },
        sources: [],
        query,
        source: 'none' as const,
      };
      setCache(cacheKey, emptyResult);
      return NextResponse.json(emptyResult, {
        headers: { 'X-Cache': 'MISS' },
      });
    }

    // Step 2: LLM synthesis — extract structured insights from snippets.
    const today = new Date().toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const systemPrompt = `Tu es un analyste football expert. Aujourd'hui c'est ${today}.
Analyse les résultats de recherche web suivants pour le match ${home} vs ${away}${competition ? ` (${competition})` : ''}.
Tu disposes de TROIS blocs de snippets :
  1. "SNIPPETS MATCH"      → contexte général du match (news, blessures, lineups, pronostics)
  2. "SNIPPETS BUTEURS"    → prédictions de buteurs par les sites experts (Forebet, PredictZ, SportyTrader, Windrawwin…)
  3. "SNIPPETS TOP SCORER" → classement des meilleurs buteurs du tournoi (golden boot, capocannoniere…)

Extrais les informations STRUCTURÉES suivantes au format JSON strict:

{
  "summary": "Résumé en 2-3 phrases de la situation du match (forme récente, enjeu, contexte)",
  "injuries": [
    { "team": "home|away", "player": "Nom du joueur", "reason": "blessure/suspension/etc", "impact": "high|medium|low" }
  ],
  "team_news": [
    { "team": "home|away", "news": "Info importante (transfert, tactique, etc)" }
  ],
  "h2h": "Analyse des confrontations directes récentes (1-2 phrases)",
  "prediction_context": "Note sur un facteur qui pourrait influencer le résultat (météo, fatigue, pression, etc)",
  "score_predictions": {
    "consensus": "Score le plus prédit par les médias (ex: '2-1')",
    "confidence": "high|medium|low",
    "sources_summary": "Résumé de ce que disent les sites de pronostics (1-2 phrases)",
    "alternative_scores": ["1-1", "2-0"]
  },
  "goalscorers": {
    "top_scorer": "Nom du joueur le plus susceptible de marquer (ex: Mbappé)",
    "top_scorer_team": "home|away",
    "confidence": "high|medium|low",
    "alternative_scorers": ["Olise", "Griezmann"],
    "reasoning": "Pourquoi ce joueur (source experte citée + forme)",
    "expert_source": "Nom du site expert qui a prédit ce buteur (ex: Forebet, PredictZ, SportyTrader)"
  }
}

RÈGLES:
- Réponds UNIQUEMENT avec le JSON, sans texte avant/après.
- Si une info n'est pas mentionnée dans les snippets, mets un tableau vide ou une chaîne vide.
- Les noms de joueurs doivent être en français si possible.
- "impact": high = joueur titulaire clé, medium = rotation importante, low = remplaçant.
- Sois factuel, n'invente rien. Si les snippets ne parlent pas de blessures, injuries = [].
- Pour score_predictions: analyse les sites de pronostics mentionnés dans les snippets (Eurosport, SportyTrader, ESPN, etc.). Si aucun site de pronostic n'est mentionné, mets consensus = "" et sources_summary = "Aucune prédiction externe trouvée".

- Pour goalscorers: PRIORISE ABSOLUMENT les "SNIPPETS BUTEURS" et "SNIPPETS TOP SCORER".
  Ces snippets proviennent de sites d'experts (Forebet, PredictZ, SportyTrader, Windrawwin, etc.)
  qui publient des prédictions explicites de buteurs. Voici l'ORDRE DE PRIORITÉ à respecter :

  1. EXPLICIT PREDICTION : si un site expert (Forebet, PredictZ, SportyTrader…) nomme
     explicitement un joueur comme "first goalscorer" / "anytime goalscorer" / "buteur
     probable" pour CE match, c'est ton top_scorer. Cite ce site dans "expert_source".
     → confidence = "high"

  2. TOP SCORER DU TOURNOI : si un joueur est listé comme top scorer de la compétition
     (ex: "Mbappé top scorer Coupe du Monde 2026, 8 buts"), ET qu'il joue dans une des
     deux équipes du match, il devient le top_scorer. Cite "Classement top scorer" dans
     "expert_source".
     → confidence = "high" ou "medium" si l'équipe a plusieurs top scorers

  3. TOP SCORER DE L'ÉQUIPE (saison) : si un joueur est le meilleur buteur de son équipe
     cette saison et qu'il est mentionné dans les snippets.
     → confidence = "medium"

  4. JOUEUR EN FORME : si un joueur a marqué récemment (cité dans les snippets match).
     → confidence = "low"

  5. AUCUNE INFO : si AUCUN joueur n'est mentionné nulle part dans les snippets buteurs
     ni top scorer ni match, mets top_scorer = "" et alternative_scorers = [].

  RÈGLES SPÉCIFIQUES BUTEURS :
  - Les "SNIPPETS BUTEURS" sont TA SOURCE PRINCIPALE. Toujours les analyser en premier.
  - Si les "SNIPPETS BUTEURS" sont vides MAIS que les "SNIPPETS TOP SCORER" contiennent
    un joueur de l'une des deux équipes, utilise ce joueur.
  - Le champ "expert_source" DOIT contenir le nom du site expert (Forebet, PredictZ,
    SportyTrader, Windrawwin, OddsPortal, etc.) si tu as trouvé une prédiction explicite.
  - Le champ "reasoning" DOIT expliquer en 1 phrase pourquoi (ex: "Forebet prédit Mbappé
    comme buteur ; il est aussi top scorer du tournoi avec 8 buts").
  - top_scorer_team doit être "home" si le buteur joue dans l'équipe domicile, "away" sinon.
  - N'invente JAMAIS un nom de joueur qui n'apparaît dans AUCUN snippet.`;

    const userPrompt = `=== SNIPPETS MATCH (contexte général) ===
${rawSnippets || '(aucun snippet match trouvé)'}

=== SNIPPETS BUTEURS (Forebet, PredictZ, SportyTrader, Windrawwin…) ===
${scorerSnippets || '(aucun snippet buteurs trouvé)'}

=== SNIPPETS TOP SCORER (classement buteurs du tournoi) ===
${topScorerSnippets || '(aucun snippet top scorer trouvé)'}

Analyse ce match en priorisant les SNIPPETS BUTEURS et TOP SCORER pour le champ "goalscorers". Extrais les insights au format JSON strict.`;

    let insights: any = null;
    try {
      const zai = await ZAI.create();
      // Bound the LLM call — without this a slow upstream could hang the request.
      const completion = await withTimeout(
        zai.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1, // Très bas pour résultats déterministes (même buteur sur tous devices)
          max_tokens: 1500,
        }),
        30_000,
        'LLM completion',
      );

      const content = completion.choices?.[0]?.message?.content || '';
      let jsonStr = content.trim();
      // Strip optional ```json fenced code block wrapper.
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      }
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      insights = JSON.parse(jsonStr);
    } catch (llmErr) {
      // Log server-side only — do NOT leak to client.
      console.error('[web-search] LLM synthesis failed:', llmErr instanceof Error ? llmErr.message : llmErr);
      // Fallback: return raw snippets without LLM processing.
      insights = {
        summary:
          'Analyse IA indisponible — voir les sources ci-dessous pour le détail.',
        injuries: [],
        team_news: [],
        h2h: '',
        prediction_context: '',
        score_predictions: { ...EMPTY_SCORE_PREDICTIONS },
        goalscorers: { ...EMPTY_GOALSCORERS },
      };
    }

    // Defensive normalization — ensure expected shapes.
    if (!Array.isArray(insights.injuries)) insights.injuries = [];
    if (!Array.isArray(insights.team_news)) insights.team_news = [];
    if (typeof insights.summary !== 'string') insights.summary = '';
    if (typeof insights.h2h !== 'string') insights.h2h = '';
    if (typeof insights.prediction_context !== 'string')
      insights.prediction_context = '';

    // Normalize score_predictions into a safe shape.
    if (!insights.score_predictions || typeof insights.score_predictions !== 'object') {
      insights.score_predictions = { ...EMPTY_SCORE_PREDICTIONS };
    } else {
      const sp = insights.score_predictions;
      if (typeof sp.consensus !== 'string') sp.consensus = '';
      if (!['high', 'medium', 'low'].includes(sp.confidence)) sp.confidence = 'low';
      if (typeof sp.sources_summary !== 'string') sp.sources_summary = '';
      if (!Array.isArray(sp.alternative_scores)) sp.alternative_scores = [];
      else sp.alternative_scores = sp.alternative_scores.filter((s: unknown) => typeof s === 'string').slice(0, 5);
    }

    // Normalize goalscorers into a safe shape (LLM may omit/wrongly-type fields).
    if (!insights.goalscorers || typeof insights.goalscorers !== 'object') {
      insights.goalscorers = { ...EMPTY_GOALSCORERS };
    } else {
      const gs = insights.goalscorers;
      if (typeof gs.top_scorer !== 'string') gs.top_scorer = '';
      gs.top_scorer_team = gs.top_scorer_team === 'away' ? 'away' : 'home';
      if (!['high', 'medium', 'low'].includes(gs.confidence)) gs.confidence = 'low';
      if (!Array.isArray(gs.alternative_scorers)) gs.alternative_scorers = [];
      else gs.alternative_scorers = gs.alternative_scorers.filter((s: unknown) => typeof s === 'string').slice(0, 5);
      if (typeof gs.reasoning !== 'string') gs.reasoning = '';
      if (typeof gs.expert_source !== 'string') gs.expert_source = '';
    }

    // Construit la liste des sources affichées au client : on priorise les sources
    // buteurs (Forebet, PredictZ, SportyTrader…) car elles sont les plus pertinentes
    // pour justifier la prédiction du buteur, puis on complète avec les sources match.
    const allSourcesForClient = [
      ...scorerResults.slice(0, 3),
      ...topScorerResults.slice(0, 2),
      ...mainResults.slice(0, 4),
    ];

    // BUG #9 FIX : calculer un pronostic ajusté en fonction des blessures détectées.
    // On n'ajuste QUE si les cotes sont estimées (espn_predictor / form_based).
    // Pour les cotes réelles (draftkings / api_football / football_data), les blessures
    // sont déjà pricées par le marché → on les retourne comme info seulement.
    const adjustedPronostic = computeAdjustedPronostic(
      hasValidBasePronostic ? basePronostic : null,
      oddsSource,
      insights.injuries || [],
      home,
      away,
    );

    const result = {
      ...insights,
      sources: allSourcesForClient
        // Déduplication par URL pour ne pas afficher 2 fois le même site
        .filter((r, i, arr) => arr.findIndex((x) => x.url === r.url) === i)
        .slice(0, 6)
        .map((r) => ({
          title: r.title,
          snippet: r.snippet,
          url: r.url,
          host: r.host || '',
        })),
      query,
      source,
      // BUG #9 FIX : ajout du pronostic ajusté (peut être null si pas de base_pronostic
      // ou si les cotes sont réelles — auquel cas les blessures sont déjà pricées).
      adjusted_pronostic: adjustedPronostic,
    };

    setCache(cacheKey, result);
    return NextResponse.json(result, { headers: { 'X-Cache': 'MISS' } });
  } catch (error: unknown) {
    // === ERROR DETAIL LEAKAGE FIX ===
    // Log the full error server-side for debugging, but return a generic
    // message to the client to avoid leaking internal paths / stack traces.
    console.error('[web-search] Fatal error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        summary: 'Erreur lors de la récupération des analyses web.',
        injuries: [],
        team_news: [],
        h2h: '',
        prediction_context: '',
        score_predictions: { ...EMPTY_SCORE_PREDICTIONS },
        goalscorers: { ...EMPTY_GOALSCORERS },
        sources: [],
        error: 'Erreur interne du serveur',
      },
      { status: 500 },
    );
  }
}
