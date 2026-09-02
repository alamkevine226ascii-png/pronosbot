import { NextRequest, NextResponse } from 'next/server';
import { getFootballDataOdds, findFootballDataOdds } from './football-data';
import { getApiFootballOdds, findApiFootballOdds } from './api-football';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/soccer';

// ─────────────────────────────────────────────────────────────────────────────
// DÉCOUVERTE DYNAMIQUE DES LIGUES
// Au lieu d'une liste hardcodée, on découvre TOUTES les ligues disponibles
// via l'API ESPN. Le mapping { numeric_id → slug } est construit une fois
// et mis en cache.
// ─────────────────────────────────────────────────────────────────────────────
let leagueMapCache: Record<string, { slug: string; name: string }> | null = null;
let leagueMapTimestamp = 0;
const LEAGUE_MAP_TTL = 24 * 60 * 60 * 1000; // 24h

async function buildLeagueMap(): Promise<Record<string, { slug: string; name: string }>> {
  // Retourne le cache s'il est encore frais
  if (leagueMapCache && Date.now() - leagueMapTimestamp < LEAGUE_MAP_TTL) {
    return leagueMapCache;
  }

  console.log('[matchs] Découverte dynamique des ligues ESPN...');
  const map: Record<string, { slug: string; name: string }> = {};

  // 1. Récupérer TOUS les slugs depuis l'API des ligues (jusqu'à 9 pages)
  const allSlugs: string[] = [];
  for (let page = 1; page <= 9; page++) {
    try {
      const r = await fetch(`${ESPN_CORE}/leagues?page=${page}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) break;
      const d = await r.json();
      if (!d.items || d.items.length === 0) break;
      for (const item of d.items) {
        const ref = item.$ref || '';
        const m = ref.match(/\/leagues\/([^?]+)/);
        if (m) allSlugs.push(m[1]);
      }
      if (d.pageIndex >= d.pageCount) break;
    } catch { break; }
  }
  console.log(`[matchs] ${allSlugs.length} slugs de ligues trouvés`);

  // 2. Résoudre chaque slug en suivant $ref pour obtenir l'ID numérique
  // Batch de 10 en parallèle pour ne pas saturer ESPN
  for (let i = 0; i < allSlugs.length; i += 10) {
    const batch = allSlugs.slice(i, i + 10);
    await Promise.all(batch.map(async (slug) => {
      try {
        const r = await fetch(`${ESPN_CORE}/leagues/${slug}?lang=en&region=us`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const d = await r.json();
          const numericId = String(d.id || '');
          const name = d.name || d.displayName || slug;
          if (numericId && !map[numericId]) {
            map[numericId] = { slug, name };
          }
        }
      } catch { /* silencieux */ }
    }));
  }

  console.log(`[matchs] ${Object.keys(map).length} ligues mappées (numeric_id → slug)`);
  leagueMapCache = map;
  leagueMapTimestamp = Date.now();
  return map;
}

// Invalide le cache (utile pour les tests)
function invalidateLeagueMap() {
  leagueMapCache = null;
  leagueMapTimestamp = 0;
}

const TEAM_FR: Record<string, string> = {
  'Norway': 'Norvège', 'France': 'France', 'Senegal': 'Sénégal', 'Iraq': 'Iraq',
  'Cape Verde': 'Cap-Vert', 'Saudi Arabia': 'Arabie Saoudite',
  'Egypt': 'Égypte', 'Iran': 'Iran', 'Uruguay': 'Uruguay', 'Spain': 'Espagne',
  'New Zealand': 'Nouvelle-Zélande', 'Belgium': 'Belgique',
  'Argentina': 'Argentine', 'Brazil': 'Brésil', 'England': 'Angleterre',
  'Germany': 'Allemagne', 'Portugal': 'Portugal', 'Netherlands': 'Pays-Bas',
  'Italy': 'Italie', 'Croatia': 'Croatie', 'Japan': 'Japon',
  'Morocco': 'Maroc', 'Mexico': 'Mexique', 'USA': 'USA',
  'Australia': 'Australie', 'Poland': 'Pologne', 'Denmark': 'Danemark',
  'Switzerland': 'Suisse', 'Cameroon': 'Cameroun', 'Tunisia': 'Tunisie',
  'Qatar': 'Qatar', 'Serbia': 'Serbie', 'Canada': 'Canada',
  'Chile': 'Chili', 'Colombia': 'Colombie', 'Greece': 'Grèce',
  'Nigeria': 'Nigeria', 'Sweden': 'Suède', 'Austria': 'Autriche',
  'Paraguay': 'Paraguay', 'Costa Rica': 'Costa Rica',
};

function translateTeamFr(name: string): string {
  return TEAM_FR[name] || name;
}

// BUG #3 FIX : americanToDecimal doit retourner null (et non propager NaN)
// quand l'entrée n'est pas un nombre valide (ex: "EV", "", undefined).
// Avant : parseInt("EV") = NaN, NaN === 0 → false, NaN > 0 → false,
// Math.abs(NaN) = NaN → retourne NaN silencieusement.
// Ce NaN contamineait ensuite cote_1/cote_2/cote_N et toutes les probas.
function americanToDecimal(american: string | number): number | null {
  try {
    const a = parseInt(String(american), 10);
    if (isNaN(a) || a === 0) return null;
    if (a > 0) return Math.round((1 + a / 100) * 100) / 100;
    return Math.round((1 + 100 / Math.abs(a)) * 100) / 100;
  } catch { return null; }
}

// BUG #2 + #10 FIX : deux problèmes corrigés.
//  #2 : si DraftKings n'expose pas la cote away (c2 absent), on ne l'invente plus
//       avec une formule fausse (1.08 - 1/c1 - 1/cN) qui produisait cote away = 10.00
//       quand la marge bookmaker > 8% (fréquent). À la place, on skip ce bookmaker
//       et on laisse le caller fallback sur API-Football / Football-Data.
//  #10 : si DraftKings n'a AUCUNE cote pour ce match mais qu'ESPN expose d'autres
//        bookmakers (BetMGM, FanDuel, William Hill...), on les utilisait pas avant.
//        Maintenant on prend le 1er bookmaker valide dans la liste.
function extractOdds(comps: any): any | null {
  const oddsList = comps?.odds || [];
  if (!oddsList.length) return null;

  // Tri : DraftKings d'abord (référence), puis autres bookmakers en fallback (#10)
  const sorted = [...oddsList].sort((a, b) => {
    const aDk = a?.provider?.name?.includes('DraftKings') ? 0 : 1;
    const bDk = b?.provider?.name?.includes('DraftKings') ? 0 : 1;
    return aDk - bDk;
  });

  for (const odd of sorted) {
    // BUG #32 FIX : null-safety — certains éléments de oddsList peuvent être null
    // (ESPN renvoie parfois des entrées vides). Avant : `odd.moneyline` throwait
    // "Cannot read properties of null (reading 'moneyline')" → 36 matchs skippés.
    if (!odd || typeof odd !== 'object') continue;
    const ml = odd.moneyline || {};
    const hAm = ml.home?.close?.odds || ml.home?.open?.odds;
    const aAm = ml.away?.close?.odds || ml.away?.open?.odds;
    let dAm = ml.draw?.close?.odds || ml.draw?.open?.odds;
    if (!dAm) dAm = odd.drawOdds?.moneyLine || 0;
    const c1 = hAm ? americanToDecimal(hAm) : null;
    const c2 = aAm ? americanToDecimal(aAm) : null;
    const cN = dAm ? americanToDecimal(dAm) : null;
    // BUG #2 FIX : on exige c1 ET c2 ET cN valides. Plus d'invention de cote bidon.
    if (!c1 || !c2 || !cN) continue;
    const result: any = { cote_1: c1, cote_N: cN, cote_2: c2 };
    const tb = odd.total || {};
    if (tb.over?.close?.odds) result.cote_over25 = americanToDecimal(tb.over.close.odds);
    if (tb.under?.close?.odds) result.cote_under25 = americanToDecimal(tb.under.close.odds);
    return result;
  }
  return null;
}

// LEVEL 2: ESPN predictor / win probability → decimal cotes (8% margin). Null if absent.
// BUG #4 + #20 FIX : deux problèmes corrigés.
//  #4 : la validation `total > 1.5` était trop permissive — elle acceptait des probas
//       impossibles (home+away > 0.95 sans nul). On rejette maintenant si home+away > 0.95
//       (au moins 5% de nul requis) ou si total sort de [0.85, 1.15].
//  #20 : `Number("60%") = NaN` si ESPN renvoie des pourcentages. On strip le % avant.
function extractPredictorCotes(comps: any): any | null {
  try {
    const predictor = comps?.predictor || comps?.winProbability || null;
    if (!predictor) return null;
    // BUG #20 FIX : strip "%' et autres caractères non numériques avant Number().
    const toNum = (v: any): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const cleaned = v.replace(/[^0-9.\-]/g, '');
        const n = Number(cleaned);
        return isNaN(n) ? 0 : n;
      }
      return 0;
    };
    const home = toNum(predictor.homeWin ?? predictor.home ?? predictor.prob_1);
    const away = toNum(predictor.awayWin ?? predictor.away ?? predictor.prob_2);
    const draw = toNum(predictor.draw ?? predictor.tie ?? predictor.prob_N)
      || Math.max(0.15, 1 - home - away);
    if (!home && !away) return null;
    const total = home + draw + away;
    // BUG #4 FIX : validation plus stricte — refuse les probas mathématiquement impossibles.
    if (total < 0.85 || total > 1.15) return null;
    if (home < 0.05 || away < 0.05) return null;
    // Au moins 5% de nul (sinon c'est que les probas sont incohérentes).
    if (home + away > 0.95) return null;
    const margin = 0.92;
    const cote1 = Math.round((total / home) * margin * 100) / 100;
    const coteN = Math.round((total / draw) * margin * 100) / 100;
    const cote2 = Math.round((total / away) * margin * 100) / 100;
    if (cote1 < 1.01 || coteN < 1.01 || cote2 < 1.01) return null;
    return { cote_1: cote1, cote_N: coteN, cote_2: cote2, estimated: true, source: 'espn_predictor' as const };
  } catch { return null; }
}

// LEVEL 3: Theoretical cotes from team form. Always available.
// BUG #5 + #7 FIX : deux problèmes corrigés.
//  #5 : l'ancienne formule `homeStrength = homePts + 0.4` (offset fixe) donnait des
//       probas de nul absurdes pour les matchs équilibrés (10% au lieu de 28%).
//       On modélise maintenant l'avantage domicile comme un RATIO (homePts × 1.15),
//       et on contraint pN à rester dans [0.20, 0.35] (intervalle réaliste football).
//  #7 : si homeForm ou awayForm est en mode default (sans historique), on marque
//       la cote comme 'low_confidence' pour que l'UI puisse l'afficher différemment.
function generateFormBasedCotes(homeForm: any, awayForm: any): any {
  // 30% regression to mean (1.0) prevents extreme cotes when form is missing or extreme.
  const homePtsRaw = homeForm?.pts_moy ?? 1.0;
  const awayPtsRaw = awayForm?.pts_moy ?? 1.0;
  const homePts = (homePtsRaw * 0.7) + 0.3;
  const awayPts = (awayPtsRaw * 0.7) + 0.3;
  const totalGoalsAvg = (homeForm?.buts_marques_moy ?? 1.3) + (awayForm?.buts_marques_moy ?? 1.3);

  // BUG #5 FIX : avantage domicile en RATIO (×1.15) au lieu d'offset fixe (+0.4).
  // Pour deux équipes équilibrées (pts_moy = 1.0), on obtient pN ≈ 0.28 (réaliste)
  // au lieu de 0.10 (absurde) avec l'ancienne formule.
  const homeStrength = homePts * 1.15;
  const totalStrength = homeStrength + awayPts;
  let p1 = homeStrength / totalStrength;
  let p2 = awayPts / totalStrength;
  let pN = 1 - p1 - p2;

  // BUG FIX : moduler pN selon l'écart |p1-p2| au lieu de le forcer vers ~0.22.
  // L'ancien clamp [0.20,0.35] + renomalisation écrasait pN ≈ 0.217 partout →
  // cote_N = round(1/0.217 × 0.92) ≈ 4.60 uniforme sur tous les matchs form_based.
  // Désormais : équipes équilibrées (petit écart) → nul élevé (~0.30) ;
  // favori nettement plus fort (grand écart) → nul plus bas (~0.16-0.22).
  const gap = Math.abs(p1 - p2);
  let pNTarget = 0.30 - 0.14 * Math.min(1, gap / 0.40); // cible [0.16, 0.30]

  // Ajustement pN selon le total de buts attendus (peu de buts → plus de nuls).
  if (totalGoalsAvg < 2.0) pNTarget = Math.min(0.40, pNTarget + 0.06);
  else if (totalGoalsAvg > 3.0) pNTarget = Math.max(0.14, pNTarget - 0.04);

  // Borne réaliste mais large : jamais détruire la variation du nul.
  pNTarget = Math.max(0.14, Math.min(0.40, pNTarget));

  // On garde le ratio p1/(p1+p2) existant et on complète la masse à 1 avec pN.
  const sumWin = p1 + p2;
  pN = pNTarget;
  if (sumWin > 0) {
    p1 = (1 - pN) * (p1 / sumWin);
    p2 = (1 - pN) * (p2 / sumWin);
  }

  const margin = 0.92;
  // BUG #7 FIX : flag low_confidence si une des forms est en mode default.
  const isLowConfidence = homeForm?.is_default || awayForm?.is_default;
  return {
    cote_1: Math.round((1 / p1) * margin * 100) / 100,
    cote_N: Math.round((1 / pN) * margin * 100) / 100,
    cote_2: Math.round((1 / p2) * margin * 100) / 100,
    estimated: true,
    source: 'form_based' as const,
    low_confidence: !!isLowConfidence,
  };
}

// BUG #1 FIX : parseScore extrait en fonction module-level (avant, elle était
// définie à l'intérieur de getTeamForm, donc inutilisable ailleurs).
// ESPN renvoie c.score comme un OBJET {value, displayValue, winner} pour les
// matchs en direct et comme une string pour les matchs terminés.
// Cette fonction est maintenant réutilisée à la ligne ~870 pour score_home/score_away.
function parseScore(s: any): number {
  if (s == null) return 0;
  if (typeof s === 'number') return isNaN(s) ? 0 : s;
  if (typeof s === 'object') {
    const v = Number(s.value ?? s.displayValue ?? 0);
    return isNaN(v) ? 0 : Math.round(v);
  }
  const n = parseInt(String(s), 10);
  return isNaN(n) ? 0 : n;
}

// BUG #18 FIX : cache module-level pour getTeamForm.
// Avant : chaque refresh (5 min) lançait ~200 appels ESPN (2 par match × 100 matchs).
// Maintenant : cache 1h par (teamId, compId) — les forms changent lentement.
interface FormCacheEntry { form: any; timestamp: number; }
const formCache = new Map<string, FormCacheEntry>();
const FORM_CACHE_TTL = 3_600_000; // 1 heure
const FORM_CACHE_MAX = 500;       // LRU eviction (~250 équipes × 2 comps max)

async function getTeamForm(teamId: string, compId: string): Promise<any> {
  // BUG #18 FIX : check cache d'abord.
  const cacheKey = `${compId}:${teamId}`;
  const cached = formCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < FORM_CACHE_TTL) {
    // BUG-19 FIX : vrai LRU — Map garde l'ordre d'insertion, donc on re-touche la clé
    // accédée pour la déplacer en fin d'ordre (les plus récemment utilisés survivent).
    // Avant : `formCache.keys().next()` retirait la PLUS ANCIENNE insertion (FIFO),
    // pas la moins utilisée — sous-optimal quand des équipes chaudes sont accédées en boucle.
    formCache.delete(cacheKey);
    formCache.set(cacheKey, cached);
    return cached.form;
  }

  try {
    const resp = await fetch(`${ESPN_BASE}/${compId}/teams/${teamId}/schedule`, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return defaultForm();
    const data = await resp.json();
    const matches: any[] = [];
    // BUG #8 FIX : seuil de récence — on ne garde que les matchs des 6 derniers mois.
    // Avant : on prenait `slice(-5)` sur TOUS les matchs historiques, y compris ceux
    // d'il y a plusieurs années (équipes nationales en trêve, équipes en pause hivernale).
    // Une "forme" basée sur des matchs de 6 mois n'a aucune valeur prédictive.
    const RECENCY_MS = 180 * 24 * 60 * 60 * 1000; // 6 mois
    const now = Date.now();
    for (const ev of data.events || []) {
      const comps = ev.competitions?.[0] || {};
      if (!comps.status?.type?.completed) continue;
      // BUG #8 FIX : filtrer par date du match.
      const evDate = ev.date ? Date.parse(ev.date) : 0;
      if (!evDate || now - evDate > RECENCY_MS) continue;
      for (const c of comps.competitors || []) {
        if (String(c.team?.id) === String(teamId)) {
          // BUG #1 FIX : parseScore est maintenant une fonction module-level.
          const score = parseScore(c.score);
          let oppScore = 0; let oppName = '?'; const isHome = c.homeAway === 'home';
          for (const oc of comps.competitors || []) {
            if (oc !== c) {
              oppScore = parseScore(oc.score);
              oppName = oc.team?.displayName || '?';
            }
          }
          matches.push({ scored: score, conceded: oppScore, result: score > oppScore ? 'W' : score === oppScore ? 'D' : 'L', is_home: isHome, opponent: oppName, date: evDate });
          break;
        }
      }
    }
    // Trier par date ascendante avant de prendre les 5 plus récents.
    matches.sort((a, b) => a.date - b.date);
    // Augmenté de 3 à 5 matchs — réduit la variance, forme plus représentative.
    const recent = matches.slice(-5);
    if (!recent.length) return defaultForm();
    const n = recent.length;
    const form = {
      buts_marques_moy: Math.round(recent.reduce((s,m)=>s+m.scored,0)/n*100)/100,
      buts_encaisses_moy: Math.round(recent.reduce((s,m)=>s+m.conceded,0)/n*100)/100,
      pts_moy: Math.round((recent.filter(m=>m.result==='W').length*3+recent.filter(m=>m.result==='D').length)/n*100)/100,
      nb_matchs: n, wins: recent.filter(m=>m.result==='W').length, draws: recent.filter(m=>m.result==='D').length, losses: recent.filter(m=>m.result==='L').length,
      forme_str: recent.map(m=>m.result).join(''), details: recent,
      is_default: false, // BUG #7 FIX : flag pour distinguer d'une defaultForm
    };
    // BUG #18 FIX : stocker dans le cache (avec LRU eviction).
    if (formCache.size >= FORM_CACHE_MAX) {
      const oldestKey = formCache.keys().next().value;
      if (oldestKey) formCache.delete(oldestKey);
    }
    formCache.set(cacheKey, { form, timestamp: Date.now() });
    return form;
  } catch { return defaultForm(); }
}

// BUG #7 FIX : defaultForm marque is_default=true pour que generateFormBasedCotes
// puisse flaguer la cote comme 'low_confidence'.
function defaultForm() {
  return {
    buts_marques_moy: 1.3,
    buts_encaisses_moy: 1.1,
    pts_moy: 1.0,
    nb_matchs: 0, wins: 0, draws: 0, losses: 0,
    forme_str: '???', details: [],
    is_default: true, // BUG #7 FIX
  };
}

function detectContext(ev: any, compId: string): any {
  const text = ((ev.notes||[]).map((n:any)=>String(n.headline||'')).join(' ')+(ev.name||'')+(ev.shortName||'')).toLowerCase();
  if (text.match(/round of 16|8e|r16/i)) return { phase:'eliminatoire', enjeu:0.9, description:'8e de finale' };
  if (text.match(/quarterfinal|quart/i)) return { phase:'eliminatoire', enjeu:0.95, description:'Quart de finale' };
  if (text.match(/semifinal|demi/i)) return { phase:'eliminatoire', enjeu:1.0, description:'Demi-finale' };
  if (text.match(/final|finale/i)) return { phase:'eliminatoire', enjeu:1.0, description:'Finale' };
  if (text.match(/group|groupe/i)) return { phase:'groupe', enjeu:0.5, description:'Phase de groupes' };
  if (compId==='fifa.world') return { phase:'groupe', enjeu:0.5, description:'Phase de groupes' };
  return { phase:'championnat', enjeu:0.3, description:'Championnat' };
}

function generatePronostic(match: any): any {
  const cotes = match.cotes;
  if (!cotes || !cotes.cote_1 || !cotes.cote_N || !cotes.cote_2) return null;

  const inv1 = 1/cotes.cote_1, invN = 1/cotes.cote_N, inv2 = 1/cotes.cote_2;
  const total = inv1 + invN + inv2;
  let p1 = inv1/total, pN = invN/total, p2 = inv2/total;

  // === BUG #33 FIX : favori selon les COTES (référence absolue, calculé AVANT tout ajustement) ===
  // On détermine le favori à partir des cotes brutes, AVANT d'appliquer quoi que ce soit.
  // Cet objet `cotesFavorite` est utilisé pour la sélection de paris (1X2, DC, HT/FT) afin
  // que la recommandation suive TOUJOURS le favori des cotes, même si l'ajustement de forme
  // (appliqué plus bas) inverse temporairement p1 et p2 dans les probas affichées.
  //
  // Avant : `favTeam = p1 > p2 ? 'home' : 'away'` était calculé APRÈS l'ajustement de forme.
  // Si la forme inversait le favori, la recommandation de paris partait sur le mauvais favori
  // → "Victoire Equipe 2 ou Nul" affiché alors que cotes donnaient Equipe 1 favori.
  const cotesFavorite: 'home' | 'away' = p1 > p2 ? 'home' : 'away';

  // === BUG #33 FIX : ajustement de forme désactivé pour les cotes RÉELLES ===
  // Les bookmakers (DraftKings, API-Football, Football-Data) ont DÉJÀ pricé la forme,
  // les blessures, le contexte, la météo, etc. dans leurs cotes. Appliquer notre propre
  // ajustement de forme par-dessus crée un DOUBLE COMPTAGE :
  //   1. Bookmaker voit que home est en mauvaise forme → cote home = 2.20 (45%)
  //   2. Notre code voit cote 2.20 + mauvaise forme → enlève encore 8% sur home
  //   3. Résultat : home passe à 35%, away monte à 36% → favori inversé → mauvais paris
  //
  // Pour les cotes RÉELLES, on n'ajuste pas. Pour les cotes ESTIMÉES (espn_predictor,
  // form_based), la forme apporte une vraie info car les cotes n'intègrent pas la forme.
  const realOddsSources = ['draftkings', 'api_football', 'football_data'];
  const isRealOdds = realOddsSources.includes(match.odds_source);
  const formAdjMultiplier = isRealOdds ? 0.0 : 1.0; // 0% pour cotes réelles, 100% pour estimées

  const initialGap = Math.abs(p1 - p2);
  const maxFormAdj = Math.max(0.005, initialGap * 0.40);

  const hf = match.home_form || {}, af = match.away_form || {};
  const formDiff = (hf.pts_moy||1) - (af.pts_moy||1);
  // formDiff/8 = ±12.5% max théorique, mais on borne à maxFormAdj (anti-inversion)
  // Multiplié par formAdjMultiplier (0 pour cotes réelles → pas d'ajustement)
  const formAdj = Math.max(-maxFormAdj, Math.min(maxFormAdj, formDiff/8)) * formAdjMultiplier;
  p1 = Math.max(0.05, Math.min(0.85, p1 + formAdj));
  p2 = Math.max(0.05, Math.min(0.85, p2 - formAdj));
  pN = Math.max(0.10, Math.min(0.45, 1-p1-p2));
  const t2 = p1+pN+p2; p1/=t2; pN/=t2; p2/=t2;

  // Sécurité : si malgré tout p1/p2 sont inversés vs les cotes (ne devrait pas arriver
  // avec formAdj=0 pour cotes réelles), on re-force le favori des cotes.
  // (réservé aux cas pathologiques où formAdj fait basculer pour cotes estimées)
  // IMPORTANT : on ne swappe PAS p1 et p2 — on utilise juste `cotesFavorite` plus bas
  // pour la sélection de paris, ce qui évite le bug historique de désynchronisation.

  // Context adjustment
  // BUG #21 FIX : utiliser ctx.enjeu (0.3 → 1.0) pour moduler l'ajustement du nul.
  // Avant : ajustement fixe -0.05 sur pN pour tous les matchs éliminatoires.
  // Maintenant : en finale (enjeu=1.0), +0.05 sur pN (équipes prudentes → plus de nuls).
  // En 8e (enjeu=0.9), -0.02 sur pN (jeu plus offensif). En championnat (enjeu=0.3), pas d'ajustement.
  const ctx = match.context || {};
  if (ctx.phase === 'eliminatoire') {
    // Plus l'enjeu est élevé (finale), plus les équipes sont prudentes → plus de nuls.
    // Formule : pN += (enjeu - 0.5) * 0.10 → finale (+0.05), 8e (-0.02), groupe (0.0)
    const enjeu = typeof ctx.enjeu === 'number' ? ctx.enjeu : 0.5;
    const pNAdjust = (enjeu - 0.5) * 0.10;
    pN = Math.max(0.15, Math.min(0.45, pN + pNAdjust));
    if (p1 > p2) p1 = Math.min(0.85, p1 + 0.03); else p2 = Math.min(0.85, p2 + 0.03);
    const t3 = p1+pN+p2; p1/=t3; pN/=t3; p2/=t3;
  }

  // === xG MODEL: form (40%) + cotes-derived win prob (50%) + league avg (10%) ===
  const LEAGUE_XG: Record<string, number> = {
    'fifa.world': 1.35, 'uefa.champions': 1.55, 'uefa.euro': 1.40, 'fifa.cwc': 1.35,
    'eng.1': 1.45, 'esp.1': 1.30, 'ita.1': 1.35, 'ger.1': 1.60, 'fra.1': 1.35, 'arg.1': 1.20,
    'bra.1': 1.20, 'bra.2': 1.15, 'usa.1': 1.50, 'chn.1': 1.40,
    'conmebol.libertadores': 1.35,
    // === NOUVELLES LIGUES (Option C) ===
    'uefa.europa': 1.45, 'uefa.europa.conf': 1.40, 'uefa.nations': 1.35,
    'eng.2': 1.40, 'esp.2': 1.30, 'ita.2': 1.30, 'fra.2': 1.30,
    'ned.1': 1.55, 'por.1': 1.40, 'tur.1': 1.45,
    'eng.fa': 1.40, 'eng.league_cup': 1.40, 'jpn.1': 1.40,
  };
  const leagueAvgXG = LEAGUE_XG[match.competition_id] || 1.35;
  // BUG FIX: utiliser `??` (nullish) au lieu de `||`. Un 0.00 (équipe qui ne marque
  // jamais / défense qui n'encaisse rien) est une VRAIE info, pas une donnée manquante.
  // Avec `||`, une moyenne de 0 était remplacée par la moyenne de ligue → xG pénalisé artificiellement.
  const formHomeXG = (hf.buts_marques_moy ?? leagueAvgXG) * 0.7 + (af.buts_encaisses_moy ?? leagueAvgXG * 0.85) * 0.3;
  const formAwayXG = (af.buts_marques_moy ?? leagueAvgXG) * 0.7 + (hf.buts_encaisses_moy ?? leagueAvgXG * 0.85) * 0.3;
  const cotesHomeXG = leagueAvgXG * (1 + Math.max(-0.4, Math.min(1.2, (p1 - 0.33) * 2.5)));
  const cotesAwayXG = leagueAvgXG * (1 + Math.max(-0.4, Math.min(1.2, (p2 - 0.33) * 2.5)));
  const homeXG = Math.max(0.4, Math.min(3.5, formHomeXG * 0.40 + cotesHomeXG * 0.50 + leagueAvgXG * 0.10));
  const awayXG = Math.max(0.4, Math.min(3.5, formAwayXG * 0.40 + cotesAwayXG * 0.50 + leagueAvgXG * 0.10));
  const totalGoals = homeXG + awayXG;

  // === GENERER TOUS LES PARIS POSSIBLES (varies et attractifs) ===
  const allBets: any[] = [];
  // BUG #33 FIX : utiliser cotesFavorite (calculé AVANT ajustement) au lieu de p1 > p2.
  // favTeam suit maintenant TOUJOURS le favori des cotes, même si la forme a inversé les probas.
  // favProba reste basé sur les probas ajustées (pour la précision du calcul d'EV).
  const favTeam = cotesFavorite;
  const favName = favTeam === 'home' ? match.home_name_fr : match.away_name_fr;
  const favProba = favTeam === 'home' ? p1 : p2;
  const underdogName = favTeam === 'home' ? match.away_name_fr : match.home_name_fr;
  const underdogProba = favTeam === 'home' ? p2 : p1;

  // 1. 1X2 (classique) — pari sur le favori des cotes
  allBets.push({ type: '1X2', sous_type: 'Victoire', choix: favTeam === 'home' ? '1' : '2', selection: `Victoire ${favName}`, probabilite: favProba, cote: favTeam === 'home' ? cotes.cote_1 : cotes.cote_2, ev: favProba * (favTeam === 'home' ? cotes.cote_1 : cotes.cote_2) - 1, risque: 1-favProba });

  // 2. Double Chance — LES 3 OPTIONS (1N, 12, N2) pour couvrir tous les cas
  const dc1N = p1 + pN, dcN2 = pN + p2, dc12 = p1 + p2;
  const cote1N = cotes.cote_1 && cotes.cote_N ? Math.round(1/(1/cotes.cote_1+1/cotes.cote_N)*100)/100 : 0;
  const coteN2 = cotes.cote_N && cotes.cote_2 ? Math.round(1/(1/cotes.cote_N+1/cotes.cote_2)*100)/100 : 0;
  const cote12 = cotes.cote_1 && cotes.cote_2 ? Math.round(1/(1/cotes.cote_1+1/cotes.cote_2)*100)/100 : 0;
  if (cote1N > 1) allBets.push({ type: 'Double Chance', sous_type: '1N', choix: '1N', selection: `${match.home_name_fr} ou Nul`, probabilite: dc1N, cote: cote1N, ev: dc1N*cote1N-1, risque: 1-dc1N });
  if (cote12 > 1) allBets.push({ type: 'Double Chance', sous_type: '12', choix: '12', selection: `Victoire ${match.home_name_fr} ou ${match.away_name_fr}`, probabilite: dc12, cote: cote12, ev: dc12*cote12-1, risque: 1-dc12 });
  if (coteN2 > 1) allBets.push({ type: 'Double Chance', sous_type: 'N2', choix: 'N2', selection: `${match.away_name_fr} ou Nul`, probabilite: dcN2, cote: coteN2, ev: dcN2*coteN2-1, risque: 1-dcN2 });

  // 3. PLUS DE BUTS (Over 1.5, 2.5, 3.5) — Poisson CDF pour P(total > line)
  let probas_ou: any = null;
  if (cotes.cote_over25 && cotes.cote_under25) {
    const io = 1/cotes.cote_over25, iu = 1/cotes.cote_under25, to = io+iu;
    probas_ou = { prob_over: io/to, prob_under: iu/to };
  }
  // Over 1.5 (généralement très probable)
  const pOver15 = 1 - poissonCdf(1, totalGoals);
  if (pOver15 > 0.30 && pOver15 < 0.95) {
    const coteOver15 = Math.round(1/pOver15 * 0.93 * 100) / 100;
    allBets.push({ type: 'Plus de Buts', sous_type: 'Plus de 1.5', choix: 'Over 1.5', selection: 'Plus de 1.5 buts', probabilite: pOver15, cote: coteOver15, ev: pOver15*coteOver15-1, risque: 1-pOver15 });
  }
  // Over 2.5
  let pOver25: number;
  if (cotes.cote_over25) {
    pOver25 = probas_ou ? probas_ou.prob_over : (1 - poissonCdf(2, totalGoals));
    allBets.push({ type: 'Plus de Buts', sous_type: 'Plus de 2.5', choix: 'Over 2.5', selection: 'Plus de 2.5 buts', probabilite: pOver25, cote: cotes.cote_over25, ev: pOver25*cotes.cote_over25-1, risque: 1-pOver25 });
  } else {
    pOver25 = 1 - poissonCdf(2, totalGoals);
    if (pOver25 > 0.20 && pOver25 < 0.90) {
      const coteOver25 = Math.round(1/pOver25 * 0.93 * 100) / 100;
      allBets.push({ type: 'Plus de Buts', sous_type: 'Plus de 2.5', choix: 'Over 2.5', selection: 'Plus de 2.5 buts', probabilite: pOver25, cote: coteOver25, ev: pOver25*coteOver25-1, risque: 1-pOver25 });
    }
  }
  // Over 3.5 (généralement moins probable)
  const pOver35 = 1 - poissonCdf(3, totalGoals);
  if (pOver35 > 0.15 && pOver35 < 0.80) {
    const coteOver35 = Math.round(1/pOver35 * 0.93 * 100) / 100;
    allBets.push({ type: 'Plus de Buts', sous_type: 'Plus de 3.5', choix: 'Over 3.5', selection: 'Plus de 3.5 buts', probabilite: pOver35, cote: coteOver35, ev: pOver35*coteOver35-1, risque: 1-pOver35 });
  }

  // 4. BTTS — P(both score >=1) = (1-exp(-homeXG)) * (1-exp(-awayXG))
  const pBttsYes = Math.min(0.85, Math.max(0.15, (1 - Math.exp(-homeXG)) * (1 - Math.exp(-awayXG))));
  const pBttsNo = 1 - pBttsYes;
  const coteBttsYes = Math.round(1/pBttsYes * 0.93 * 100) / 100;
  const coteBttsNo = Math.round(1/pBttsNo * 0.93 * 100) / 100;
  allBets.push({ type: 'BTTS', sous_type: 'Oui', choix: 'Oui', selection: 'Les deux équipes marquent', probabilite: pBttsYes, cote: coteBttsYes, ev: pBttsYes*coteBttsYes-1, risque: 1-pBttsYes });
  allBets.push({ type: 'BTTS', sous_type: 'Non', choix: 'Non', selection: 'Au moins une équipe ne marque pas', probabilite: pBttsNo, cote: coteBttsNo, ev: pBttsNo*coteBttsNo-1, risque: 1-pBttsNo });

  // 5. DOUBLE CHANCE + BTTS — P(DC ∩ BTTS) = P(DC) * P(BTTS) (3 combinés)
  const dcOptions = [
    { key: '1N', proba: dc1N, cote: cote1N, label: `${match.home_name_fr} ou Nul` },
    { key: '12', proba: dc12, cote: cote12, label: `Vic. ${match.home_name_fr} ou ${match.away_name_fr}` },
    { key: 'N2', proba: dcN2, cote: coteN2, label: `${match.away_name_fr} ou Nul` },
  ];
  for (const dc of dcOptions) {
    if (dc.cote <= 1) continue;
    const pCombined = dc.proba * pBttsYes; // P(DC ∩ BTTS)
    if (pCombined > 0.20 && pCombined < 0.80) {
      const coteCombined = Math.round(dc.cote * coteBttsYes * 100) / 100; // cote combinée = produit
      allBets.push({
        type: 'DC + BTTS',
        sous_type: `${dc.key} + Oui`,
        choix: `${dc.key}+BTTS`,
        selection: `${dc.label} + Les 2 marquent`,
        probabilite: pCombined,
        cote: coteCombined,
        ev: pCombined * coteCombined - 1,
        risque: 1 - pCombined,
      });
    }
  }

  // 6. BUTEUR — SUPPRIMÉ en l'absence de lineup réel.
  // BUG #14 FIX : ce pari était du bruit aléatoire présenté comme prédiction.
  // ESPN free ne fournit pas les lineups, donc on n'a aucune info sur LES JOUEURS.
  // La formule `topXG * 0.28` ne fait que estimer la proba que L'ÉQUIPE marque,
  // pas qu'un joueur précis soit buteur. Si l'utilisateur suit ce pari, il perd.
  //
  // Stratégie : on ne génère ce pari QUE si /api/web-search a identifié un buteur
  // explicite (champ `match.goalscorer.top_scorer` non vide, fourni par Forebet/
  // PredictZ/SportyTrader via le LLM). Sinon, on l'omet entièrement.
  if (match.goalscorer && typeof match.goalscorer === 'object' && match.goalscorer.top_scorer) {
    const scorerName = String(match.goalscorer.top_scorer);
    const scorerTeam = match.goalscorer.top_scorer_team === 'away' ? 'away' : 'home';
    const scorerConfidence = match.goalscorer.confidence || 'low';
    // Proba basée sur la confiance LLM (high=0.55, medium=0.40, low=0.30)
    const pButeur = scorerConfidence === 'high' ? 0.55 : scorerConfidence === 'medium' ? 0.40 : 0.30;
    const coteButeur = Math.round(1/pButeur * 0.88 * 100) / 100; // marge 12%
    allBets.push({
      type: 'Buteur',
      sous_type: scorerName,
      choix: scorerTeam,
      selection: `Buteur: ${scorerName} (${scorerTeam === 'home' ? match.home_name_fr : match.away_name_fr})`,
      probabilite: pButeur,
      cote: coteButeur,
      ev: pButeur * coteButeur - 1,
      risque: 1 - pButeur,
      expert_source: match.goalscorer.expert_source || '',
    });
  }

  // 7. Qualification (pour matchs a elimination directe)
  if (ctx.phase === 'eliminatoire') {
    const coteQualif = favTeam === 'home' ? Math.max(1.15, cotes.cote_1 * 0.75) : Math.max(1.15, cotes.cote_2 * 0.75);
    allBets.push({ type: 'Qualification', sous_type: favName, choix: favTeam === 'home' ? '1' : '2', selection: `Qualification: ${favName}`, probabilite: Math.min(0.85, favProba * 1.15), cote: coteQualif, ev: Math.min(0.85, favProba * 1.15) * coteQualif - 1, risque: 1 - Math.min(0.85, favProba * 1.15) });
  }

  // 8. Mi-temps / Fin de match (HT/FT)
  // BUG #13 FIX : le facteur 0.55 surestimait les victoires acquises dès la MT.
  // En réalité, ~35-40% des victoires finales sont déjà en tête à la MT
  // (beaucoup de buts en 2e mi-temps). On utilise 0.40 (valeur empirique).
  // On ajoute aussi les combinaisons N/1 et N/2 (nul MT, victoire FT) qui étaient
  // ignorées — ce sont des paris populaires avec de belles cotes.
  const pHomeHTHomeFT = p1 * 0.40;
  const pDrawHTHomeFT = pN * 0.45;
  const pAwayHTAwayFT = p2 * 0.40;
  // Ajout : N/1 (nul MT → victoire home FT) et N/2 (nul MT → victoire away FT)
  const pDrawHTHomeFT_win = pN * 0.25 * (p1 / (p1 + p2 + 0.001));
  const pDrawHTAwayFT_win = pN * 0.25 * (p2 / (p1 + p2 + 0.001));
  const htftTotal = pHomeHTHomeFT + pDrawHTHomeFT + pAwayHTAwayFT + pDrawHTHomeFT_win + pDrawHTAwayFT_win;
  if (htftTotal > 0) {
    // Pari principal : 1/1 (victoire home MT ET FT) si home favori, sinon 2/2.
    const p1_1 = pHomeHTHomeFT / htftTotal;
    const cote_1_1 = Math.round(1/p1_1 * 0.88 * 100) / 100;
    allBets.push({ type: 'Mi-temps/Fin', sous_type: favTeam === 'home' ? '1/1' : '2/2', choix: favTeam === 'home' ? '1-1' : '2-2', selection: `MT ${favName} / FT ${favName}`, probabilite: p1_1, cote: cote_1_1, ev: p1_1*cote_1_1-1, risque: 1-p1_1 });
    // Pari secondaire : N/1 ou N/2 (nul MT, victoire FT) — value bet attractif
    const pN_1 = pDrawHTHomeFT_win / htftTotal;
    const pN_2 = pDrawHTAwayFT_win / htftTotal;
    const pSecondary = Math.max(pN_1, pN_2);
    if (pSecondary > 0.05) {
      const secondaryTeam = pN_1 > pN_2 ? 'home' : 'away';
      const secondaryName = secondaryTeam === 'home' ? match.home_name_fr : match.away_name_fr;
      const cote_secondary = Math.round(1/pSecondary * 0.88 * 100) / 100;
      allBets.push({ type: 'Mi-temps/Fin', sous_type: `N/${secondaryTeam === 'home' ? '1' : '2'}`, choix: `N-${secondaryTeam === 'home' ? '1' : '2'}`, selection: `MT Nul / FT ${secondaryName}`, probabilite: pSecondary, cote: cote_secondary, ev: pSecondary*cote_secondary-1, risque: 1-pSecondary });
    }
  }

  // 9. Score exact (top 3) — Dixon-Coles corrected Poisson (0-5 buts)
  // BUG #15 FIX : le rho était trop proche de 1.0 (0.92-0.98), ce qui rendait
  // la correction Dixon-Coles négligeable (1-rho = 0.02 à 0.08) — 2 à 10x trop
  // faible vs les valeurs empiriques (1-rho ≈ 0.10 à 0.20).
  // Valeurs standard Dixon-Coles : rho ∈ [-0.20, -0.05] selon le total de buts.
  // Ici on encode directement 1-rho (positif, range 0.10-0.18).
  const dcCorrection = totalGoals < 2.2 ? 0.18 : totalGoals < 3.0 ? 0.13 : 0.10;
  // (équivalent rho = 1 - dcCorrection ∈ [0.82, 0.90])
  const scores: any[] = [];
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      const poissonH = Math.pow(homeXG, h) * Math.exp(-homeXG) / factorial(h);
      const poissonA = Math.pow(awayXG, a) * Math.exp(-awayXG) / factorial(a);
      let prob = poissonH * poissonA; // DC correction below (only 0-0, 1-0, 0-1, 1-1)
      if (h === 0 && a === 0) prob *= (1 - homeXG * awayXG * dcCorrection);
      else if (h === 1 && a === 0) prob *= (1 + awayXG * dcCorrection);
      else if (h === 0 && a === 1) prob *= (1 + homeXG * dcCorrection);
      else if (h === 1 && a === 1) prob *= (1 - dcCorrection);
      prob = Math.max(0.001, prob);
      scores.push({ score: `${h}-${a}`, prob, cote: Math.round(1/prob * 0.85 * 100) / 100 });
    }
  }
  scores.sort((a, b) => b.prob - a.prob);
  const top3Scores = scores.slice(0, 3);
  for (const s of top3Scores) {
    allBets.push({ type: 'Score exact', sous_type: s.score, choix: s.score, selection: `Score ${s.score}`, probabilite: s.prob, cote: s.cote, ev: s.prob*s.cote-1, risque: 1-s.prob });
  }

  // === SELECTION DU MEILLEUR PARI ===
  // Objectif : paris variés + attractifs (cote 1.5-3.0) + value (EV positif).
  // Évite que le système recommande toujours "Double Chance" à cote 1.30.
  for (const bet of allBets) {
    // 1. PÉNALITÉ cote peu attractive : cote < 1.5 = pénalité (paris ennuyeux)
    //    Zone sweet spot : 1.5-3.0 (attractif sans être trop risqué)
    //    Cote > 3.0 = bonus modéré (value bets)
    let coteScore: number;
    if (bet.cote < 1.40) coteScore = -0.15; // pénalité forte (pari trop sûr, peu attractif)
    else if (bet.cote < 1.50) coteScore = -0.05; // légère pénalité
    else if (bet.cote <= 3.00) coteScore = 0.15; // sweet spot = bonus
    else coteScore = 0.10; // value bet (risqué mais grosse cote)

    // 2. BONUS favori : plus fort pour DC/1X2 (évite recommander underdog),
    //    plus faible pour les autres types (pas pertinent pour BTTS/Over).
    let favoriteBonus = 0;
    let underdogPenalty = 0;
    if (bet.type === '1X2') {
      if (bet.choix === (favTeam === 'home' ? '1' : '2')) favoriteBonus = 0.10;
      else underdogPenalty = -0.15; // pénalise la recommandation de l'underdog en 1X2
    }
    if (bet.type === 'Double Chance') {
      const includesFavorite =
        (favTeam === 'home' && (bet.choix === '1N' || bet.choix === '12')) ||
        (favTeam === 'away' && (bet.choix === 'N2' || bet.choix === '12'));
      const isUnderdogDC =
        (favTeam === 'home' && bet.choix === 'N2') ||
        (favTeam === 'away' && bet.choix === '1N');
      if (includesFavorite) favoriteBonus = 0.08;
      if (isUnderdogDC) underdogPenalty = -0.20; // forte pénalité : DC de l'underdog
    }
    if (bet.type === 'Qualification' && bet.choix === (favTeam === 'home' ? '1' : '2')) favoriteBonus = 0.08;

    // 3. BONUS diversité : favorise les types de paris moins fréquents
    //    (BTTS, Buteur, DC+BTTS, Plus de Buts, Score exact, Mi-temps)
    //    pour éviter que 1X2 et DC dominent toujours.
    let diversityBonus = 0;
    if (bet.type === 'BTTS') diversityBonus = 0.06;
    if (bet.type === 'Plus de Buts') diversityBonus = 0.05;
    if (bet.type === 'Buteur') diversityBonus = 0.04;
    if (bet.type === 'DC + BTTS') diversityBonus = 0.07;
    if (bet.type === 'Score exact') diversityBonus = 0.03;

    // 4. SCORE FINAL : EV (30%) + proba (20%) + cote attractiveness (25%) + diversité (15%) + favori (10%)
    bet.score_selection = bet.ev * 0.30 + bet.probabilite * 0.20 + coteScore + diversityBonus + favoriteBonus + underdogPenalty;
    bet.r2 = Math.round(bet.ev * 10000) / 10000;
    bet.risque = Math.round(bet.risque * 100) / 100;
  }

  // Filtrer: proba >= 40%, cote >= 1.3 ET EV >= -0.05 (BUG QA FIX : ne plus
  // recommander de paris franchement perdants — un pari à EV très négative
  // fait perdre de l'argent en moyenne, ce qui contredit la promesse du produit).
  // Si AUCUN pari ne passe le filtre EV, on retombe sur viableBets sans la
  // contrainte EV mais on flag le pari choisi comme `ev_negative`.
  const evFloor = -0.05;
  const evViableBets = allBets.filter(b => b.probabilite >= 0.40 && b.cote >= 1.3 && b.ev >= evFloor);
  const viableBets = allBets.filter(b => b.probabilite >= 0.40 && b.cote >= 1.3);
  const sortedBets = (evViableBets.length > 0 ? evViableBets : viableBets.length > 0 ? viableBets : allBets)
    .sort((a, b) => b.score_selection - a.score_selection);
  const bestBet = sortedBets[0];
  if (bestBet && bestBet.ev < evFloor) {
    bestBet.ev_negative = true; // l'UI peut afficher un avertissement "aucun pari rentable détecté"
  }

  // === TOTAL ASIATIQUE (analyse uniquement — hors tous_paris) ===
  // Lignes asiatiques ¼ (1.25, 1.75, 2.25...) = moyenne de 2 demi-lignes (remboursement partiel).
  // Lignes ½ (1.5, 2.5, 3.5) = remboursement intégral si égalité.
  // P(over) calculée via Poisson CDF sur le total de buts attendu.
  const asianLines = [1.25, 1.5, 1.75, 2.25, 2.5, 2.75, 3.25, 3.5, 3.75];
  const asian_totals: any[] = [];
  for (const line of asianLines) {
    const isQuarter = (line * 4) % 2 !== 0;
    let pOver: number;
    if (isQuarter) {
      const lower = Math.floor(line * 2) / 2;
      const upper = lower + 0.5;
      pOver = ((1 - poissonCdf(lower, totalGoals)) + (1 - poissonCdf(upper, totalGoals))) / 2;
    } else {
      pOver = 1 - poissonCdf(line, totalGoals);
    }
    const pUnder = 1 - pOver;
    if (pOver > 0.10 && pOver < 0.95) {
      asian_totals.push({
        line,
        type: isQuarter ? 'quarter' as const : 'half' as const,
        prob_over: Math.round(pOver * 10000) / 10000,
        prob_under: Math.round(pUnder * 10000) / 10000,
        cote_over: Math.round(1 / pOver * 0.93 * 100) / 100,
        cote_under: Math.round(1 / pUnder * 0.93 * 100) / 100,
        recommendation: pOver > 0.60 ? 'Over' : pUnder > 0.60 ? 'Under' : 'Neutre',
      });
    }
  }

  return {
    probas_1x2: { prob_1: Math.round(p1*10000)/10000, prob_N: Math.round(pN*10000)/10000, prob_2: Math.round(p2*10000)/10000 },
    probas_ou,
    double_chance: { '1N': { proba: dc1N, cote: cote1N }, 'N2': { proba: dcN2, cote: coteN2 }, '12': { proba: dc12, cote: cote12 } },
    pari_choisi: bestBet,
    tous_paris: sortedBets.slice(0, 8),
    top_scores: top3Scores,
    expected_goals: { home: Math.round(homeXG*100)/100, away: Math.round(awayXG*100)/100, total: Math.round(totalGoals*100)/100 },
    asian_totals,
  };
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

function poissonCdf(k: number, lambda: number): number {
  let cdf = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    cdf += Math.pow(lambda, i) * Math.exp(-lambda) / factorial(i);
  }
  return Math.min(1, cdf);
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

function generateCombiners(matchs: any[]): any[] {
  /* Genere des paris combines varies et attractifs. */
  const combinable = matchs.filter(m => m.pronostic?.tous_paris && m.pronostic.tous_paris.length > 0);
  if (combinable.length < 2) return [];

  // Pour chaque match, prendre le 2eme ou 3eme meilleur pari (plus varie)
  const matchBets = combinable.map(m => {
    const bets = m.pronostic.tous_paris;
    // Varier : parfois le 1er, parfois le 2eme, parfois le 3eme
    // Use deterministic index based on match ID to avoid hydration mismatch
    const idx = Math.abs(hashCode(m.id || '')) % Math.min(3, bets.length);
    return {
      match: m,
      bet: bets[idx],
    };
  }).filter(mb => mb.bet && mb.bet.probabilite >= 0.40 && mb.bet.cote >= 1.30);

  if (matchBets.length < 2) return [];

  // Trier par cote decroissante (pour combinés attractifs)
  matchBets.sort((a, b) => b.bet.cote - a.bet.cote);

  const combiners: any[] = [];

  // Combiné 2 matchs - varier les types de paris
  for (let i = 0; i < Math.min(4, matchBets.length - 1); i++) {
    for (let j = i + 1; j < Math.min(6, matchBets.length); j++) {
      const mb1 = matchBets[i], mb2 = matchBets[j];
      const b1 = mb1.bet, b2 = mb2.bet;
      const coteCombined = Math.round(b1.cote * b2.cote * 100) / 100;
      const probCombined = b1.probabilite * b2.probabilite;
      const evCombined = probCombined * coteCombined - 1;
      // Ne garder que les combinés avec cote > 1.5 (attractif)
      if (coteCombined < 1.50) continue;
      combiners.push({
        type: 'Combiné 2',
        matchs: [
          { home: mb1.match.home_name_fr, away: mb1.match.away_name_fr, bet_type: b1.type, bet_selection: b1.selection, cote: b1.cote, competition: mb1.match.competition, heure: mb1.match.heure, date_match: mb1.match.date_match },
          { home: mb2.match.home_name_fr, away: mb2.match.away_name_fr, bet_type: b2.type, bet_selection: b2.selection, cote: b2.cote, competition: mb2.match.competition, heure: mb2.match.heure, date_match: mb2.match.date_match },
        ],
        cote_combinee: coteCombined,
        probabilite: Math.round(probCombined * 10000) / 10000,
        ev: Math.round(evCombined * 10000) / 10000,
        risque: Math.round((1 - probCombined) * 100) / 100,
      });
    }
  }

  // Combiné 3 matchs (cotes plus elevees, plus attractif)
  if (matchBets.length >= 3) {
    for (let i = 0; i < Math.min(2, matchBets.length - 2); i++) {
      const top3 = [matchBets[i], matchBets[i+1], matchBets[i+2]];
      const bets = top3.map(mb => mb.bet);
      const coteCombined = Math.round(bets.reduce((p, b) => p * b.cote, 1) * 100) / 100;
      const probCombined = bets.reduce((p, b) => p * b.probabilite, 1);
      const evCombined = probCombined * coteCombined - 1;
      if (coteCombined < 2.0) continue;
      combiners.push({
        type: 'Combiné 3',
        matchs: top3.map(mb => ({
          home: mb.match.home_name_fr, away: mb.match.away_name_fr,
          bet_type: mb.bet.type, bet_selection: mb.bet.selection, cote: mb.bet.cote,
          competition: mb.match.competition, heure: mb.match.heure, date_match: mb.match.date_match,
        })),
        cote_combinee: coteCombined,
        probabilite: Math.round(probCombined * 10000) / 10000,
        ev: Math.round(evCombined * 10000) / 10000,
        risque: Math.round((1 - probCombined) * 100) / 100,
      });
    }
  }

  // Combiné 4 matchs (le plus attractif)
  if (matchBets.length >= 4) {
    const top4 = matchBets.slice(0, 4);
    const bets = top4.map(mb => mb.bet);
    const coteCombined = Math.round(bets.reduce((p, b) => p * b.cote, 1) * 100) / 100;
    const probCombined = bets.reduce((p, b) => p * b.probabilite, 1);
    const evCombined = probCombined * coteCombined - 1;
    combiners.push({
      type: 'Combiné 4',
      matchs: top4.map(mb => ({
        home: mb.match.home_name_fr, away: mb.match.away_name_fr,
        bet_type: mb.bet.type, bet_selection: mb.bet.selection, cote: mb.bet.cote,
        competition: mb.match.competition, heure: mb.match.heure, date_match: mb.match.date_match,
      })),
      cote_combinee: coteCombined,
      probabilite: Math.round(probCombined * 10000) / 10000,
      ev: Math.round(evCombined * 10000) / 10000,
      risque: Math.round((1 - probCombined) * 100) / 100,
    });
  }

  // Trier par attractivite (cote * proba)
  combiners.sort((a, b) => (b.cote_combinee * b.probabilite) - (a.cote_combinee * a.probabilite));
  return combiners.slice(0, 6);
}

function validateDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return raw;
}

/**
 * Build the date range string for the ESPN API.
 * When week=true, returns a 7-day range (today → +7 days) formatted as
 * 'YYYYMMDD-YYYYMMDD' so ESPN returns all matches in a SINGLE request per league.
 * This is far more efficient than one request per day (was 7 req/league → now 1).
 * When week is falsy, returns a single day 'YYYYMMDD'.
 *
 * Returns { rangeStr, datesArray } where:
 * - rangeStr is passed to ESPN (e.g. '20260708-20260715')
 * - datesArray is the list of individual day strings for the UI DayTabs
 */
function buildDateRange(weekParam: string | null, dateStr: string): { rangeStr: string; datesArray: string[] } {
  if (weekParam) {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + 7); // 7 jours — plage standard (corrigé : le commentaire disait « 21 jours »)
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    };
    const rangeStr = `${fmt(today)}-${fmt(end)}`;
    // Build the list of individual day strings for the UI DayTabs
    const datesArray: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      datesArray.push(`${y}-${m}-${day}`);
    }
    return { rangeStr, datesArray };
  }
  // Single day mode
  const single = dateStr.replace(/-/g, '');
  return { rangeStr: single, datesArray: [dateStr] };
}

/**
 * Fetch all matches for the given date range (parallel across leagues),
 * generate pronostics + combiners, and return the API response payload.
 * Extracted from GET so it can be called both from the blocking path and
 * from the SWR background refetch.
 *
 * @param rangeStr - ESPN date range string (e.g. '20260708-20260728' or '20260708')
 * @param datesArray - list of individual day strings for the UI DayTabs
 */
async function buildResponseData(rangeStr: string, datesArray: string[]): Promise<any> {
  const allMatchs: any[] = [];

  // === API-FOOTBALL: vraies cotes multi-bookmakers (3 jours, free tier, cache 1h) ===
  // BUG FIX : si un provider de cotes tierces throw (clé absente/expirée, panne API),
  // ça ne doit PAS faire échouer toute la collecte ESPN → fallback sur Map vide,
  // les matchs ESPN restent collectés (form-based odds en dernier recours).
  let afOddsMap: Map<string, any>;
  try {
    console.log('[matchs] Récupération cotes API-Football...');
    afOddsMap = await getApiFootballOdds();
    console.log(`[matchs] API-Football: ${afOddsMap.size} matchs avec cotes multi-bookmakers`);
  } catch (e) {
    console.warn(`[matchs] API-Football indisponible (${e instanceof Error ? e.message : 'unknown'}) — collecte ESPN poursuivie avec cotes form-based`);
    afOddsMap = new Map();
  }

  // === FOOTBALL-DATA.ORG: cotes agrégées multi-bookmakers (cache 10 min) ===
  let fdOddsMap: Map<string, any>;
  try {
    console.log('[matchs] Récupération cotes Football-Data.org...');
    fdOddsMap = await getFootballDataOdds();
    console.log(`[matchs] Football-Data: ${fdOddsMap.size} matchs avec cotes disponibles`);
  } catch (e) {
    console.warn(`[matchs] Football-Data org indisponible (${e instanceof Error ? e.message : 'unknown'}) — collecte ESPN poursuivie`);
    fdOddsMap = new Map();
  }

  // === APPROCHE UNIFIÉE : 1 SEUL appel à l'endpoint "all" + résolution des ligues ===
  // L'endpoint /all/scoreboard retourne TOUS les matchs de TOUTES les compétitions
  // disponibles sur ESPN en UN SEUL appel. Les IDs de ligues sont numériques (dans l'UID).
  // On les résout en slugs via l'API de découverte des ligues.
  // → Plus de liste hardcodée, plus de 25 appels parallèles.
  let totalEventsESPN = 0;
  let eventsProcessed = 0;
  let eventsSkipped = 0;

  // Construire (ou utiliser le cache) du mapping ID numérique → slug
  const leagueMap = await buildLeagueMap();

  try {
      const resp = await fetch(
        `${ESPN_BASE}/all/scoreboard?dates=${rangeStr}&limit=500`,
        { signal: AbortSignal.timeout(15000) }
      );

      if (!resp.ok) {
        console.warn(`[matchs] ESPN all/scoreboard: HTTP ${resp.status} — fallback sur contenu du cache`);
      } else {
        const data = await resp.json();
        const events = data.events || [];
        totalEventsESPN = events.length;
        console.log(`[matchs] ESPN all/scoreboard: ${events.length} événements trouvés (toutes ligues confondues)`);

        for (const ev of events) {
          try {
            const comps = ev.competitions?.[0] || {};
            const competitors = comps.competitors || [];
            if (competitors.length < 2) {
              eventsSkipped++;
              continue;
            }

            // Extraire l'ID numérique de la ligue depuis l'UID de la compétition
            // Format: "s:600~l:3954~e:401875201~c:401875201"
            const uid = comps.uid || '';
            const numericId = uid.match(/l:(\d+)/)?.[1] || '';
          
            // Résoudre la ligue via le mapping → obtenir slug + nom
            const leagueInfo = leagueMap[numericId] || {};
            const leagueSlug = leagueInfo.slug || `league_${numericId}`;
            const realLeagueName = leagueInfo.name || `Compétition #${numericId}`;

            const home = competitors.find((c:any)=>c.homeAway==='home') || competitors[0];
            const away = competitors.find((c:any)=>c.homeAway==='away') || competitors[1];
            const homeName = home.team?.displayName || '?';
            const awayName = away.team?.displayName || '?';
            const homeId = String(home.team?.id||'');
            const awayId = String(away.team?.id||'');
            const homeLogo = home.team?.logo || '';
            const awayLogo = away.team?.logo || '';
            const homeColor = home.team?.color || '';
            const awayColor = away.team?.color || '';

            let heure = '??:??';
            let matchDate = '';
            if (ev.date) {
              try {
                const dt = new Date(ev.date);
                heure = dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
                matchDate = dt.toISOString().split('T')[0];
              } catch {}
            }

            // === HYBRID ODDS FALLBACK: DraftKings → API-Football → Football-Data → ESPN predictor → form-based ===
            let cotes = extractOdds(comps);
            let oddsSource: 'draftkings' | 'api_football' | 'football_data' | 'espn_predictor' | 'form_based' = 'draftkings';

            if (!cotes) {
              const afResult = await findApiFootballOdds(homeName, awayName, afOddsMap);
              if (afResult) {
                cotes = { ...afResult.cotes, estimated: false, source: 'api_football' };
                oddsSource = 'api_football';
              }
            }

            if (!cotes) {
              const fdResult = await findFootballDataOdds(homeName, awayName, fdOddsMap);
              if (fdResult) {
                cotes = { ...fdResult.cotes, estimated: false, source: 'football_data' };
                oddsSource = 'football_data';
              }
            }

            if (!cotes && (cotes = extractPredictorCotes(comps))) oddsSource = 'espn_predictor';
            const context = detectContext(ev, leagueSlug);
            const [homeForm, awayForm] = await Promise.all([getTeamForm(homeId, leagueSlug), getTeamForm(awayId, leagueSlug)]);
            if (!cotes) { cotes = generateFormBasedCotes(homeForm, awayForm); oddsSource = 'form_based'; }

            const match = {
              id: String(ev.id||''), home_name: homeName, away_name: awayName,
              home_name_fr: translateTeamFr(homeName), away_name_fr: translateTeamFr(awayName),
              home_id: homeId, away_id: awayId, competition: realLeagueName, competition_id: leagueSlug,
              home_logo: homeLogo, away_logo: awayLogo, home_color: homeColor, away_color: awayColor,
              heure, cotes, odds_source: oddsSource, status: comps.status?.type?.shortName||'?',
              score_home: parseScore(home.score), score_away: parseScore(away.score),
              live_status: comps.status?.type?.shortName||'',
              is_live: ['1H','HT','2H','ET','P','BT','LIVE'].includes(comps.status?.type?.shortName||''),
              home_form: homeForm, away_form: awayForm, context, date_match: matchDate,
            };

            const pronostic = generatePronostic(match);
            allMatchs.push({ ...match, pronostic });
            eventsProcessed++;
          } catch (e) {
            console.warn(`[matchs] Parse error: ${e instanceof Error ? e.message : 'unknown'}`);
            eventsSkipped++;
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      const isTimeout = e instanceof Error && e.name === 'TimeoutError';
      console.warn(`[matchs] ESPN all/scoreboard: ${isTimeout ? 'TIMEOUT (>15s)' : 'échec réseau'} — ${msg}`);
    }

    // === LOG DE DIAGNOSTIC ===
    console.log(`[matchs] ESPN: ${totalEventsESPN} événements bruts | ${eventsProcessed} gardés | ${eventsSkipped} ignorés | ${allMatchs.length} matchs avec pronostics`);
    if (eventsSkipped > 0) {
      console.warn(`[matchs] ${eventsSkipped} événements ignorés (compétiteurs insuffisants ou erreur de parsing)`);
    }

  // Trier par date + heure
  allMatchs.sort((a, b) => {
    const dateA = (a.date_match || '') + ' ' + (a.heure || '');
    const dateB = (b.date_match || '') + ' ' + (b.heure || '');
    return dateA.localeCompare(dateB);
  });

  const combiners = generateCombiners(allMatchs);

  return {
    matchs: allMatchs,
    combiners,
    dates: datesArray,
    count: allMatchs.length,
  };
}

// Cache : in-memory LRU (fast path) + write-through/read-through Redis (cold-start resilience).
// Avant : cache purement in-memory → à chaque cold-start Vercel (go dormant), le cache était
// vidé et le PREMIER utilisateur déclenchait ~45 requêtes HTTP parallèles → timeout sur le
// plan gratuit (10s). Maintenant le cache est persisté dans Redis (si UPSTASH_REDIS_* est
// configuré) et rechargé au démarrage : un cold start sert l'état précédent instantanément,
// puis refraîchit en arrière-plan.
export async function GET(request: NextRequest) {
  // === Parse query parameters
  const searchParams = request.nextUrl.searchParams;
  const weekParam = searchParams.get('week');
  const dateStr = validateDate(searchParams.get('date')) || new Date().toISOString().split('T')[0];

  // === Build date range for ESPN API
  const { rangeStr, datesArray } = buildDateRange(weekParam, dateStr);

  // === Fetch from ESPN all/scoreboard (the only data source needed)
  const responseData = await buildResponseData(rangeStr, datesArray);

  return NextResponse.json(responseData);
}
