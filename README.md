# 🤖 PronoBot — App de pronostics football

Next.js 16 + Prisma + ESPN API + API-Football + Football-Data + LLM (z-ai-web-dev-sdk)

## 🎯 Fonctionnalités

- **Pronostics multi-ligues** : 28 ligues (Top 5 européen + coupes + Brésil + Argentine + MLS + Asie)
- **8 types de paris** : 1X2, Double Chance, Over/Under, BTTS, DC+BTTS, Buteur, HT/FT, Score exact
- **Sources de cotes hybrides** (fallback en cascade) :
  1. DraftKings (via ESPN) — vraies cotes
  2. API-Football (multi-bookmakers agrégés) — vraies cotes
  3. Football-Data.org (11 bookmakers agrégés) — vraies cotes
  4. ESPN Predictor (win probability) — cotes estimées
  5. Form-based model (Poisson + Dixon-Coles) — cotes estimées
- **Analyse web IA** : pour chaque match, recherche web (Forebet, PredictZ, SportyTrader...) qui récupère :
  - Blessures et suspensions
  - Actus équipes
  - Confrontations directes (H2H)
  - Score consensus
  - Buteur probable
  - **Ajustement automatique des probas** si les cotes sont estimées (pas de double comptage avec cotes réelles)
- **Combinés automatiques** : génère 6 combinés (2/3/4 matchs) avec probabilité et EV
- **Cache distribué** : Redis (Upstash) avec fallback in-memory
- **Rate limiting** : 10 req/min par IP sur `/api/matchs`, 5 req/min sur `/api/web-search`
- **PWA** : installable sur mobile, fonctionne hors-ligne (Service Worker)

## 🏗️ Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── matchs/
│   │   │   ├── route.ts          # Endpoint principal — génère tous les pronos
│   │   │   ├── api-football.ts   # Source de cotes API-Football
│   │   │   └── football-data.ts  # Source de cotes Football-Data
│   │   └── web-search/
│   │       └── route.ts          # Analyse web IA (LLM + web search)
│   ├── page.tsx                  # Page principale (UI complète)
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── web-insights.tsx          # Card d'analyse web IA
│   ├── access-gate.tsx
│   ├── cookie-banner.tsx
│   ├── install-prompt.tsx
│   ├── legal-rgpd-cards.tsx
│   ├── sw-register.tsx
│   └── ui/                       # Composants shadcn/ui
├── lib/
│   ├── redis.ts                  # Cache + rate limiting (Redis ou in-memory)
│   ├── db.ts                     # Prisma client
│   └── utils.ts
└── hooks/
    ├── use-toast.ts
    └── use-mobile.ts

prisma/
└── schema.prisma                 # 7 modèles : User, Post, Competition, Team, Match, Pronostic, UserBet
```

## 🛠️ Installation locale

### Prérequis
- Node.js 18+ ou Bun 1.0+
- Une base SQLite (pour dev) ou Postgres (pour prod)

### Étapes
```bash
# 1. Installer les dépendances
bun install

# 2. Copier le template .env
cp .env.example .env

# 3. Remplir .env avec tes clés API
#    - FOOTBALL_DATA_TOKEN (https://www.football-data.org/client/register)
#    - API_FOOTBALL_KEY (https://www.api-football.com/)
#    - DATABASE_URL (SQLite local : file:./db/custom.db)

# 4. Initialiser la DB
bunx prisma db push
bunx prisma generate

# 5. Lancer en dev
bun dev
# → http://localhost:3000

# 6. Build production
bun run build
bun run start
```

## 🐛 Bugs corrigés (20 au total)

Voir `GUIDE-DEPLOIEMENT-VERCEL.md` pour la liste complète et le déploiement.

### Critiques
- #1 score_home/score_away affichaient [object Object]
- #2 extractOdds inventait une cote away bidon à 10.00
- #3 americanToDecimal propageait NaN silencieusement
- #5 generateFormBasedCotes produisait pN absurde (10% au lieu de 28%)
- #7 defaultForm silencieux (matchs sans historique identiques)
- #8 getTeamForm utilisait des matchs vieux de plusieurs années
- #9 blessures LLM n'impactaient JAMAIS les probas → nouveau computeAdjustedPronostic()
- #14 pari "Buteur" sans joueur nommé → supprimé sauf si LLM identifie un buteur
- #18 pas de cache getTeamForm → 200 appels ESPN/refresh (maintenant 1h cache + LRU)
- #31 aucun modèle Prisma métier → 5 nouveaux modèles (Competition, Team, Match, Pronostic, UserBet)

### Majeurs
- #10 extractOdds ignorait tous les bookmakers sauf DraftKings
- #13 HT/FT facteur 0.55 trop élevé → 0.40 + ajout paris N/1 et N/2
- #15 Dixon-Coles rho trop faible (0.02-0.08) → 0.10-0.18
- #16 caches api-football/football-data perdus en cold start → migration vers Redis
- #20 extractPredictorCotes ne parsait pas "60%"
- #21 ctx.enjeu calculé mais inutilisé → modulation de pN selon l'enjeu
- #28 is_live manquait les statuts BT et LIVE
- #32 extractOdds crashait sur odd=null (36 matchs skippés)

## 🚀 Déploiement

Voir `GUIDE-DEPLOIEMENT-VERCEL.md` pour le guide complet Vercel.

Résumé :
1. Push le code sur GitHub
2. Import le repo sur Vercel
3. Configurer les variables d'environnement (DATABASE_URL, FOOTBALL_DATA_TOKEN, API_FOOTBALL_KEY)
4. Pour la prod, passer de SQLite à Postgres (Neon recommandé, gratuit)
5. Déployer 🚀

## 📊 Stack technique

| Côté | Tech |
|------|------|
| Frontend | Next.js 16, React 19, Tailwind 4, shadcn/ui, framer-motion |
| Backend | API Routes Next.js, Prisma ORM |
| DB | SQLite (dev) / Postgres (prod via Neon) |
| Cache | Upstash Redis (avec fallback in-memory) |
| Sources cotes | ESPN, API-Football, Football-Data.org |
| IA | z-ai-web-dev-sdk (web_search + chat completions) |
| Monitoring | Sentry (optionnel) |
| PWA | manifest.json + service worker |

## 📝 License

Code source — à adapter selon tes besoins.

## 🤝 Contribution

Ce projet a été audité et 20 bugs ont été corrigés. Pour contribuer :
1. Check les issues ouvertes
2. Crée une branche : `git checkout -b feature/xxx`
3. Commit : `git commit -m "feat: xxx"`
4. Push : `git push origin feature/xxx`
5. Ouvre une Pull Request
