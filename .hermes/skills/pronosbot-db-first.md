# PronosBot DB-First

## Trigger
Use when setting up or modifying PronosBot with Neon PostgreSQL DB-First architecture, replacing ESPN real-time scraping with database reads, or configuring cron sync jobs.

## One-line behavior
Configure PronosBot to read match data from PostgreSQL Neon instead of scraping ESPN live, with automated cron synchronization and HTTP caching to prevent Vercel 504 timeouts.

## Core Skills

### 1. Route `/api/matchs` — DB-First Read
**File:** `src/app/api/matchs/route.ts`

**Pattern:** Read from PostgreSQL via Prisma instead of scraping ESPN. Fall back to mock data on error. Add `Cache-Control: public, s-maxage=60, stale-while-revalidate=120` header.

**Key implementation details:**
- Use `prisma.match.findMany()` with filters (`competition`, `status`, `limit`)
- Include related data: `competition`, `home_team`, `away_team`
- Sort by `kickoff` descending (most recent first)
- Pagination via `cursor` param or basic `take`/`skip`
- Return `hasMore` boolean for frontend infinite scroll
- On DB error: return mock data + same cache headers

**Pitfall — Avoid N+1 queries:** Always `include` related models in single query.

### 2. Cron Route `/api/cron/sync-matches` — ESPN → Neon
**File:** `src/app/api/cron/sync-matches/route.ts`

**Pattern:** Single route that scrapes all 200+ ESPN leagues, does upsert into Neon BDD. Secured by Bearer token.

**Workflow:**
1. Validate `Authorization: Bearer <CRON_SECRET>` header (401 if missing)
2. Cache with 1-min cooldown to prevent double-syncs
3. Fetch ESPN `all/scoreboard?limit=500` (15s timeout via `AbortSignal`)
4. For each event: upsert `Competition` → `Team` → `Match` → `Pronostic`
5. Return counts: processed, created, updated, skipped
6. Schedule via `vercel.json` cron: `"every 30 minutes"`

### 3. Vercel Cron Configuration
**File:** `vercel.json`

```json
{
  "crons": {
    "/api/cron/sync-matches": {
      "schedule": "every 30 minutes",
      "handlerRequest": { "protocol": "http", "default": "post" }
    }
  }
}
```

### 4. Prisma Schema (`prisma/schema.prisma`)
Core models: Competition, Match, Team, User, Account, Session, UserBet, Pronostic, SystemConfig.

## Cache Strategy
- HTTP `Cache-Control: public, s-maxage=60, stale-while-revalidate=120` prevents 504 on Vercel Hobby plan.
- In-memory sync cooldown 1min between cron runs.
- Fallback to mock data when DB unavailable.

## Deployment Checklist
- [ ] `prisma schema.prisma` committed & `prisma generate` run
- [ ] `DATABASE_URL` set in Vercel env vars
- [ ] `NEXTAUTH_URL` and `NEXTAUTH_SECRET` set
- [ ] `CRON_SECRET` set (keep secret!)
- [ ] `vercel.json` cron configured
- [ ] First sync triggered manually to populate DB
- [ ] Verify `npm run build` succeeds
- [ ] Test `/api/matchs` returns < 100ms
- [ ] Test cron sync populates tables

---