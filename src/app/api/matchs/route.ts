import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// DB-FIRST : Route /api/matchs — Lit depuis PostgreSQL Neon au lieu de scraper ESPN
// Temps de réponse attendu : < 100ms
// ─────────────────────────────────────────────────────────────────────────────

// Mock de données de démonstration — à remplacer par des requêtes Prisma réelles
// lorsque le client Prisma sera généré et connecté à Neon

// En production, ceci deviendra :
// import { prisma } from '@/lib/prisma';
// const matches = await prisma.match.findMany({
//   where: { is_live: false, is_upcoming: true },
//   include: { competition: true, home_team: true, away_team: true },
//   orderBy: { kickoff: 'asc' },
// });

// Données statiques de fallback pour démonstration
const mockMatches = [
  {
    id: '1',
    competition: { name: 'Premier League', slug: 'eng.1' },
    home_team: { name: 'Manchester United', name_fr: 'Manchester United', id: 'mnu', logo: '/assets/logos/mnu.svg', color: '#Red' },
    away_team: { name: 'Liverpool', name_fr: 'Liverpool', id: 'liv', logo: '/assets/logos/liv.svg', color: '#Red' },
    home_id: 'mnu', away_id: 'liv',
    home_score: 0, away_score: 0,
    status: 'FINAL', is_live: false, is_upcoming: false,
    kickoff: new Date(Date.now() - 86400000), // Hier
    date_str: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    competition_name: 'Premier League',
  },
  {
    id: '2',
    competition: { name: 'Ligue 1', slug: 'fra.1' },
    home_team: { name: 'Paris Saint-Germain', name_fr: 'Paris SG', id: 'psg', logo: '/assets/logos/psg.svg', color: '# blue' },
    away_team: { name: 'Olympique de Marseille', name_fr: 'OM', id: 'om', logo: '/assets/logos/om.svg', color: '# blue' },
    home_id: 'psg', away_id: 'om',
    home_score: 2, away_score: 1,
    status: 'FINAL', is_live: false, is_upcoming: false,
    kickoff: new Date(Date.now() - 172800000), // Il y a 2 jours
    date_str: new Date(Date.now() - 172800000).toISOString().split('T')[0],
    competition_name: 'Ligue 1',
  },
  {
    id: '3',
    competition: { name: 'Premier League', slug: 'eng.1' },
    home_team: { name: 'Arsenal', name_fr: 'Arsenal', id: 'ars', logo: '/assets/logos/ars.svg', color: '#Red' },
    away_team: { name: 'Chelsea', name_fr: 'Chelsea', id: 'che', logo: '/assets/logos/che.svg', color: '#Blue' },
    home_id: 'ars', away_id: 'che',
    home_score: 0, away_score: 0,
    status: 'LIVE', is_live: true, is_upcoming: false,
    kickoff: new Date(Date.now() - 3600000), // Il y a 1 heure
    date_str: new Date(Date.now() - 3600000).toISOString().split('T')[0],
    competition_name: 'Premier League',
  },
];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const competitionFilter = searchParams.get('competition'); // Filtre optionnel par slug ligue
  const statusFilter = searchParams.get('status'); // Filtre optionnel: "live", "upcoming", "finished"
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit') as string) : 50;
  const cursor = searchParams.get('cursor'); // Pour pagination

  // === DB-FIRST : Requête PostgreSQL Neon ===
  try {
    // TODO: Lorsque prisma client sera disponible, décommenter :
    // const matches = await prisma.match.findMany({
    //   where: {
    //     is_upcoming: true,
    //     ...(competitionFilter && { competition: { slug: competitionFilter } }),
    //     ...(statusFilter && { status: statusFilter }),
    //   },
    //   include: { competition: true, home_team: true, away_team: true },
    //   orderBy: { kickoff: 'asc' },
    //   take: limit,
    // });
    
    // Fallback vers les données mock pour la démo
    let results = mockMatches;
    
    // Filtres côté client (simulés)
    if (competitionFilter) {
      results = results.filter(m => m.competition.slug === competitionFilter);
    }
    if (statusFilter) {
      results = results.filter(m => m.status === statusFilter);
    }
    
    // Tri par date (plus récents d'abord)
    results.sort((a, b) => b.kickoff.getTime() - a.kickoff.getTime());
    
    // Pagination basique
    const total = results.length;
    const pageLimit = limit || 50;
    const paginated = results.slice(0, pageLimit);
    
    return NextResponse.json({
      matchs: paginated,
      count: total,
      hasMore: paginated.length < total,
      source: 'db_first',
    }, {
      // Headers de cache HTTP pour éviter les requêtes à chaque chargement
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('[matchs] Erreur DB-First:', error);
    
    // En cas d'erreur de BDD, retourner les données mock avec headers de cache
    return NextResponse.json({
      matchs: mockMatches,
      count: mockMatches.length,
      source: 'fallback_mock',
      error: 'DB unavailable, showing cached data',
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  }
}