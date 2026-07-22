/**
 * Football-Data.org integration — supplementary odds source.
 * Aggregates odds from 11 bookmakers (Bet365, Bwin, William Hill, etc.)
 * instead of just DraftKings (ESPN).
 *
 * Free tier: 10 req/min — we make max 12 req per refresh (one per mapped competition).
 * Cache: 10 minutes (longer than API cache because odds don't change fast).
 */

import { cacheGet } from '@/lib/redis';

const FD_BASE = 'https://api.football-data.org/v4';
const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN;

export interface FdMatch {
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
}

// ESPN competition ID → Football-Data competition code
const ESPN_TO_FD: Record<string, string> = {
  'eng.1': 'PL',
  'eng.2': 'ELC',
  'esp.1': 'PD',
  'ita.1': 'SA',
  'ger.1': 'BL1',
  'fra.1': 'FL1',
  'ned.1': 'DED',
  'por.1': 'PPL',
  'bra.1': 'BSA',
  'uefa.champions': 'CL',
  'uefa.euro': 'EC',
  'conmebol.libertadores': 'CLI',
};

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(fc|cf|sc|ac|afc|cd|club|de)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchKey(home: string, away: string): string {
  return `${normalizeTeamName(home)}-${normalizeTeamName(away)}`;
}

async function fetchCompetitionMatches(fdCode: string): Promise<Map<string, FdMatch>> {
  const result = new Map<string, FdMatch>();
  if (!FD_TOKEN) return result;

  try {
    const resp = await fetch(
      `${FD_BASE}/competitions/${fdCode}/matches?status=SCHEDULED`,
      {
        headers: { 'X-Auth-Token': FD_TOKEN },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!resp.ok) {
      console.warn(`[football-data] ${fdCode}: HTTP ${resp.status}`);
      return result;
    }
    const data = await resp.json();
    const matches = data.matches || [];

    for (const m of matches) {
      const homeName = m.homeTeam?.name || m.homeTeam?.shortName || '';
      const awayName = m.awayTeam?.name || m.awayTeam?.shortName || '';
      if (!homeName || !awayName) continue;

      const bookmakers = m.odds?.bookmakers || [];
      if (bookmakers.length === 0) continue;

      const homeOdds: number[] = [];
      const drawOdds: number[] = [];
      const awayOdds: number[] = [];
      const overOdds: number[] = [];
      const underOdds: number[] = [];

      for (const bm of bookmakers) {
        for (const bet of bm.bets || []) {
          if (bet.id === 1 || bet.name === 'Match Result') {
            for (const v of bet.values || []) {
              const odd = parseFloat(v.odd);
              if (isNaN(odd) || odd < 1.0) continue;
              if (v.value === 'HOME') homeOdds.push(odd);
              else if (v.value === 'DRAW') drawOdds.push(odd);
              else if (v.value === 'AWAY') awayOdds.push(odd);
            }
          }
          if (bet.id === 5 || bet.name === 'Over/Under 2.5 Goals') {
            for (const v of bet.values || []) {
              const odd = parseFloat(v.odd);
              if (isNaN(odd) || odd < 1.0) continue;
              if (v.value === 'OVER 2.5') overOdds.push(odd);
              else if (v.value === 'UNDER 2.5') underOdds.push(odd);
            }
          }
        }
      }

      if (homeOdds.length === 0 || drawOdds.length === 0 || awayOdds.length === 0) continue;

      const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;

      result.set(matchKey(homeName, awayName), {
        cotes: {
          cote_1: Math.round(avg(homeOdds) * 100) / 100,
          cote_N: Math.round(avg(drawOdds) * 100) / 100,
          cote_2: Math.round(avg(awayOdds) * 100) / 100,
          cote_over25: overOdds.length > 0 ? Math.round(avg(overOdds) * 100) / 100 : undefined,
          cote_under25: underOdds.length > 0 ? Math.round(avg(underOdds) * 100) / 100 : undefined,
        },
        bookmakerCount: bookmakers.length,
        homeName,
        awayName,
        date: m.utcDate || '',
      });
    }
    return result;
  } catch (e) {
    console.warn(`[football-data] ${fdCode}: ${e instanceof Error ? e.message : 'unknown'}`);
    return result;
  }
}

export async function getFootballDataOdds(): Promise<Map<string, FdMatch>> {
  const merged = new Map<string, FdMatch>();

  const fetchPromises: Promise<void>[] = [];
  for (const [, fdCode] of Object.entries(ESPN_TO_FD)) {
    fetchPromises.push((async () => {
      const matches = await cacheGet<Map<string, FdMatch>>(
        `fdOdds:${fdCode}`,
        () => fetchCompetitionMatches(fdCode),
        600
      );
      for (const [key, value] of matches) {
        merged.set(key, value);
      }
    })());
  }
  await Promise.all(fetchPromises);
  return merged;
}

export async function findFootballDataOdds(
  homeName: string,
  awayName: string,
  fdMap: Map<string, FdMatch>
): Promise<{ cotes: any; bookmakerCount: number } | null> {
  const key = matchKey(homeName, awayName);
  const match = fdMap.get(key);
  if (match) {
    return { cotes: match.cotes, bookmakerCount: match.bookmakerCount };
  }
  const normHome = normalizeTeamName(homeName);
  const normAway = normalizeTeamName(awayName);
  for (const [mapKey, mapMatch] of fdMap) {
    if (mapKey.includes(normHome) && mapKey.includes(normAway)) {
      return { cotes: mapMatch.cotes, bookmakerCount: mapMatch.bookmakerCount };
    }
  }
  return null;
}

export function isCompetitionSupported(espnId: string): boolean {
  return espnId in ESPN_TO_FD;
}

export const FD_COMPETITIONS = ESPN_TO_FD;
