/**
 * API-Football (api-sports.io) integration — real multi-bookmaker odds.
 *
 * Free tier: 100 req/day, 3-day rolling window (today-2 → today+2... actually
 * the API told us "try from 2026-07-10 to 2026-07-12" = today and next 2 days).
 *
 * Strategy: fetch odds for today, tomorrow, and day after tomorrow (3 requests).
 * Each request returns ALL matches with odds from multiple bookmakers.
 * Cache for 1 hour (odds don't change fast in this window).
 *
 * This gives REAL odds (not estimated) for matches happening in the next 3 days,
 * which is when users care most about predictions.
 */

import { cacheGet } from '@/lib/redis';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

interface AfMatch {
  cotes: {
    cote_1: number;
    cote_N: number;
    cote_2: number;
    cote_over25?: number;
    cote_under25?: number;
  };
  bookmakerCount: number;
  homeName: string;
  awayName: string;
  date: string;
  league: string;
}

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(fc|cf|sc|ac|afc|cd|club|de|cf|sadium)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchKey(home: string, away: string): string {
  return `${normalizeTeamName(home)}-${normalizeTeamName(away)}`;
}

/**
 * Fetch odds for a specific date from API-Football.
 * Returns a Map<matchKey, AfMatch>.
 */
async function fetchOddsForDate(dateStr: string): Promise<Map<string, AfMatch>> {
  const result = new Map<string, AfMatch>();
  if (!API_FOOTBALL_KEY) return result;

  try {
    // Step 1: get fixtures for this date (to know team names)
    const fixturesResp = await fetch(
      `${API_FOOTBALL_BASE}/fixtures?date=${dateStr}`,
      {
        headers: { 'x-apisports-key': API_FOOTBALL_KEY },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!fixturesResp.ok) {
      console.warn(`[api-football] fixtures ${dateStr}: HTTP ${fixturesResp.status}`);
      return result;
    }
    const fixturesData = await fixturesResp.json();
    if (fixturesData.errors && Object.keys(fixturesData.errors).length > 0) {
      // Free tier date restriction — skip silently
      return result;
    }

    // Build fixture ID → team names map
    const fixtures: Map<number, { home: string; away: string; league: string }> = new Map();
    for (const f of fixturesData.response || []) {
      const fixtureId = f.fixture?.id;
      const homeName = f.teams?.home?.name || '';
      const awayName = f.teams?.away?.name || '';
      const leagueName = f.league?.name || '';
      if (fixtureId && homeName && awayName) {
        fixtures.set(fixtureId, { home: homeName, away: awayName, league: leagueName });
      }
    }

    // Step 2: get odds for this date
    const oddsResp = await fetch(
      `${API_FOOTBALL_BASE}/odds?date=${dateStr}`,
      {
        headers: { 'x-apisports-key': API_FOOTBALL_KEY },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!oddsResp.ok) {
      console.warn(`[api-football] odds ${dateStr}: HTTP ${oddsResp.status}`);
      return result;
    }
    const oddsData = await oddsResp.json();
    if (oddsData.errors && Object.keys(oddsData.errors).length > 0) {
      return result;
    }

    // Step 3: aggregate odds per fixture across all bookmakers
    // Group by fixture ID, then average odds across bookmakers
    const fixtureOdds: Map<number, { home: number[]; draw: number[]; away: number[]; over: number[]; under: number[]; bookmakers: Set<string> }> = new Map();

    for (const oddEntry of oddsData.response || []) {
      const fixtureId = oddEntry.fixture?.id;
      if (!fixtureId || !fixtures.has(fixtureId)) continue;

      const bookmakerName = oddEntry.bookmaker?.name || 'unknown';
      const bets = oddEntry.bookmaker?.bets || [];

      if (!fixtureOdds.has(fixtureId)) {
        fixtureOdds.set(fixtureId, {
          home: [], draw: [], away: [], over: [], under: [],
          bookmakers: new Set(),
        });
      }
      const fo = fixtureOdds.get(fixtureId)!;
      fo.bookmakers.add(bookmakerName);

      for (const bet of bets) {
        // Match Winner (1X2)
        if (bet.name === 'Match Winner' || bet.name === '1x2') {
          for (const v of bet.values || []) {
            const odd = parseFloat(v.odd);
            if (isNaN(odd) || odd < 1.0) continue;
            if (v.value === 'Home') fo.home.push(odd);
            else if (v.value === 'Draw') fo.draw.push(odd);
            else if (v.value === 'Away') fo.away.push(odd);
          }
        }
        // Over/Under 2.5
        if (bet.name === 'Over/Under 2.5' || bet.name === 'Over/Under' || bet.name === 'Goals Over/Under') {
          for (const v of bet.values || []) {
            const odd = parseFloat(v.odd);
            if (isNaN(odd) || odd < 1.0) continue;
            if (v.value === 'Over 2.5' || v.value === 'Over') fo.over.push(odd);
            else if (v.value === 'Under 2.5' || v.value === 'Under') fo.under.push(odd);
          }
        }
      }
    }

    // Step 4: build the result map
    for (const [fixtureId, fo] of fixtureOdds) {
      if (fo.home.length === 0 || fo.draw.length === 0 || fo.away.length === 0) continue;
      const fixtureInfo = fixtures.get(fixtureId)!;
      const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;

      result.set(matchKey(fixtureInfo.home, fixtureInfo.away), {
        cotes: {
          cote_1: Math.round(avg(fo.home) * 100) / 100,
          cote_N: Math.round(avg(fo.draw) * 100) / 100,
          cote_2: Math.round(avg(fo.away) * 100) / 100,
          cote_over25: fo.over.length > 0 ? Math.round(avg(fo.over) * 100) / 100 : undefined,
          cote_under25: fo.under.length > 0 ? Math.round(avg(fo.under) * 100) / 100 : undefined,
        },
        bookmakerCount: fo.bookmakers.size,
        homeName: fixtureInfo.home,
        awayName: fixtureInfo.away,
        date: dateStr,
        league: fixtureInfo.league,
      });
    }

    return result;
  } catch (e) {
    console.warn(`[api-football] ${dateStr}: ${e instanceof Error ? e.message : 'unknown'}`);
    return result;
  }
}

/**
 * Get API-Football odds for the next 5 days (tries all, keeps what works).
 * The free tier allows a 3-day window that isn't always today-based.
 * By trying 5 dates, we catch whatever window is available.
 * Uses 10 API calls (5 fixtures + 5 odds) on the 100/day limit.
 * Cached for 1 hour.
 */
export async function getApiFootballOdds(): Promise<Map<string, AfMatch>> {
  const merged = new Map<string, AfMatch>();
  if (!API_FOOTBALL_KEY) return merged;

  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const fetchPromises: Promise<void>[] = [];
  for (const dateStr of dates) {
    fetchPromises.push((async () => {
      const matches = await cacheGet<Map<string, AfMatch>>(
        `afOdds:${dateStr}`,
        () => fetchOddsForDate(dateStr),
        3600
      );
      for (const [key, value] of matches) {
        merged.set(key, value);
      }
    })());
  }
  await Promise.all(fetchPromises);
  return merged;
}

/**
 * Look up API-Football odds for a specific match.
 * Returns null if not found.
 */
export async function findApiFootballOdds(
  homeName: string,
  awayName: string,
  afMap: Map<string, AfMatch>
): Promise<{ cotes: any; bookmakerCount: number } | null> {
  const key = matchKey(homeName, awayName);
  const match = afMap.get(key);
  if (match) {
    return { cotes: match.cotes, bookmakerCount: match.bookmakerCount };
  }
  // Fuzzy matching — BUG-20 FIX : on compare les COTÉS (home vs away) et non un simple
  // `substring includes`. L'ancien code matchait un mauvais fixture dès qu'une chaîne
  // contenait un morceau du nom (ex: "Man City" vs "City"). On exige maintenant que le
  // HOME du maplé soit dans le home demandé ET l'AWAY dans l'away demandé, avec une
  // longueur minimale pour éviter les faux positifs trop courts.
  const normHome = normalizeTeamName(homeName);
  const normAway = normalizeTeamName(awayName);
  if (!normHome || !normAway) return null;

  for (const [mapKey, mapMatch] of afMap) {
    // mapKey format: "home-away". Split on the role boundary.
    const sep = mapKey.indexOf('-');
    if (sep <= 0 || sep === mapKey.length - 1) continue;
    const mapHome = mapKey.slice(0, sep);
    const mapAway = mapKey.slice(sep + 1);
    const homeOk = mapHome.length >= 3 && normHome.includes(mapHome);
    const awayOk = mapAway.length >= 3 && normAway.includes(mapAway);
    // Also try the reverse role order (some providers swap home/away).
    const homeOkInv = mapHome.length >= 3 && normAway.includes(mapHome);
    const awayOkInv = mapAway.length >= 3 && normHome.includes(mapAway);
    if ((homeOk && awayOk) || (homeOkInv && awayOkInv)) {
      return { cotes: mapMatch.cotes, bookmakerCount: mapMatch.bookmakerCount };
    }
  }
  return null;
}

export type { AfMatch };
