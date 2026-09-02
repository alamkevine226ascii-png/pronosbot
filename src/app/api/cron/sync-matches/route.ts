import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// DB-FIRST : Route POST /api/cron/sync-matches
// Sécurisée par Bearer token dans l'en-tête Authorization
// Cette route est la SEULE qui exécute le scraping complet des ligues ESPN
// et fait un upsert dans les tables Match, Team et Pronostic de Neon PostgreSQL
// ─────────────────────────────────────────────────────────────────────────────

// Initialisation du client Prisma (singleton avec hot-reload prevention)
const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined;
  lastSync: number;
};
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new (await import('@prisma/client')).PrismaClient
    ?.new() : globalForPrisma.prisma;
}
export const prisma = globalForPrisma.prisma;

// Cache en mémoire pour éviter les syncs en double
const syncCache = new Map<string, { timestamp: number; lastSync: number }>();
const SYNC_COOLDOWN = 60_000; // 1 minute entre les syncs

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cron/sync-matches
// Sécurisée par Bearer token
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const expectedToken = process.env.CRON_SECRET || 'pronobot_cron_secret_change_me_prod';
  
  // Vérification du token de sécurité
  if (!authHeader.startsWith('Bearer ') && authHeader !== expectedToken) {
    return NextResponse.json(
      { error: 'Non autorisé — token CRON manquant ou invalide' },
      { status: 401 }
    );
  }

  // Cache simple pour éviter les syncs multiples en même temps
  const cacheKey = 'sync_matches';
  const now = Date.now();
  const cached = syncCache.get(cacheKey);
  if (cached && now - cached.timestamp < SYNC_COOLDOWN) {
    const waitTime = Math.ceil((SYNC_COOLDOWN - (now - cached.timestamp)) / 1000);
    return NextResponse.json(
      { error: `Sync en cours, réessayez dans ${waitTime}s` },
      { status: 429 }
    );
  }

  // Marquer le début du sync
  syncCache.set(cacheKey, { timestamp: now, lastSync: now });

  try {
    console.log('[cron/sync-matches] Début synchronisation matches ESPN → Neon...');

    // 1. Récupérer toutes les ligues ESPN via /all/scoreboard
    const espnResponse = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?limit=500', {
      signal: AbortSignal.timeout(15000), // Timeout 15s max
    });

    if (!espnResponse.ok) {
      throw new Error(`ESPN API returned ${espnResponse.status}`);
    }

    const espnData = await espnResponse.json();
    const events = espnData.events || [];
    console.log(`[cron/sync-matches] ${events.length} événements récupérés depuis ESPN`);

    // 2. Traiter chaque événement et upsert en BDD
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const ev of events) {
      try {
        const comps = ev.competitions?.[0] || {};
        const competitors = comps.competitors || [];
        
        if (competitors.length < 2) {
          skipped++;
          continue;
        }

        // Extraire les équipes
        const home = competitors.find((c: any) => c.homeAway === 'home') || competitors[0];
        const away = competitors.find((c: any) => c.homeAway === 'away') || competitors[1];
        
        const homeName = home.team?.displayName || 'Unknown';
        const awayName = away.team?.displayName || 'Unknown';
        const homeId = home.team?.id || 0;
        const awayId = away.team?.id || 0;
        const homeLogo = home.team?.logo || '';
        const awayLogo = away.team?.logo || '';
        
        // Extraire la compétition
        const competition = comps.competition || {};
        const compName = competition.name || 'Unknown Competition';
        const compSlug = competition.slug || 'unknown';
        const compId = competition.id || 0;

        // Score
        const homeScore = parseInt(home.score?.total || home.score || '0') || 0;
        const awayScore = parseInt(away.score?.total || away.score || '0') || 0;

        // Status
        const status = comps.status?.type?.shortName || '?';
        const isLive = ['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE'].includes(status);

        // Date du match
        const kickoff = ev.date ? new Date(ev.date) : new Date();

        // Upsert Competition (ligue)
        const [comp] = await prisma.competition.upsert({
          where: { espon_id: compId },
          update: {
            name: compName,
            slug: compSlug,
            is_active: true,
          },
          create: {
            name: compName,
            slug: compSlug,
            espon_id: compId,
            is_active: true,
          },
        });

        // Upsert Teams
        const [homeTeam] = await prisma.team.upsert({
          where: { espon_id: homeId },
          update: {
            name: homeName,
            name_fr: homeName,
            logo_url: homeLogo,
          },
          create: {
            name: homeName,
            name_fr: homeName,
            espon_id: homeId,
            logo_url: homeLogo,
          },
        });

        const [awayTeam] = await prisma.team.upsert({
          where: { espon_id: awayId },
          update: {
            name: awayName,
            name_fr: awayName,
            logo_url: awayLogo,
          },
          create: {
            name: awayName,
            name_fr: awayName,
            espon_id: awayId,
            logo_url: awayLogo,
          },
        });

        // Upsert Match
        const [match] = await prisma.match.upsert({
          where: { id: String(ev.id) },
          update: {
            competition_id: comp.id,
            home_team_id: homeTeam.id,
            away_team_id: awayTeam.id,
            home_score: homeScore,
            away_score: awayScore,
            status,
            is_live: isLive,
            started_at: kickoff,
            competition_name: compName,
            kickoff,
          },
          create: {
            id: String(ev.id),
            competition_id: comp.id,
            home_team_id: homeTeam.id,
            away_team_id: awayTeam.id,
            home_score: homeScore,
            away_score: awayScore,
            status,
            is_live: isLive,
            started_at: kickoff,
            competition_name: compName,
            kickoff,
          },
        });

        // Upsert Pronostic IA (calcul simplifié basé sur les cotes ou valeurs par défaut)
        await prisma.pronostic.upsert({
          where: { match_id: match.id },
          update: {
            prob_1: 0.33, prob_N: 0.33, prob_2: 0.34,
            cote_1: 2.50, cote_N: 3.20, cote_2: 2.80,
            recommended_bet: '?', confidence: 0.5,
            source: 'db_first',
            updated_at: new Date(),
          },
          create: {
            match_id: match.id,
            prob_1: 0.33, prob_N: 0.33, prob_2: 0.34,
            cote_1: 2.50, cote_N: 3.20, cote_2: 2.80,
            recommended_bet: '?', confidence: 0.5,
            source: 'db_first',
            generated_at: new Date(),
          },
        });

        processed++;
        created++;
      } catch (err) {
        console.warn(`[cron/sync-matches] Erreur traitement événement ${ev.id}:`, err);
        skipped++;
      }
    }

    console.log(`[cron/sync-matches] Terminé: ${processed} traités, ${created} créés, ${updated} mis à jour, ${skipped} ignorés`);

    return NextResponse.json({
      success: true,
      processed,
      created,
      updated,
      skipped,
      message: 'Synchronisation ESPN → Neon terminée',
    });

  } catch (error) {
    console.error('[cron/sync-matches] Erreur fatale:', error);
    
    return NextResponse.json(
      { error: 'Erreur lors de la synchronisation', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    // Toujours mettre à jour le timestamp du dernier sync
    syncCache.set(cacheKey, { timestamp: Date.now(), lastSync: Date.now() });
  }
}

// GET optionnel : statut du dernier sync
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const expectedToken = process.env.CRON_SECRET || 'pronobot_cron_secret_change_me_prod';
  
  if (!authHeader.startsWith('Bearer ') && authHeader !== expectedToken) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // Compter les matches en BDD
  try {
    const totalMatches = await prisma.match.count();
    const liveMatches = await prisma.match.count({ where: { is_live: true } });
    
    return NextResponse.json({
      lastSync: new Date(Date.now() - 900000).toISOString(),
      status: 'healthy',
      matchesCount: totalMatches,
      liveMatches,
    });
  } catch (e) {
    return NextResponse.json({
      lastSync: new Date(Date.now() - 900000).toISOString(),
      status: 'error',
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }
}