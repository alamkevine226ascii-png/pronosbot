# ESPN API Research — Soccer Endpoints & League Discovery

## Date: 2026-08-31

---

## 🔥 Finding #1: Global Scoreboard with `all` keyword — WORKS!

**URL:**
```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard
```

This aggregates **ALL soccer leagues** in a single API call. Returns ~79 events (today) from 28+ leagues.

**Parameters:**
- `?dates=20260831` — filter by date (format: YYYYMMDD)
- `?limit=500` — max events to return
- `?dates=20260831&limit=500` — combined

**Confirmed working today:** Returns 79 events across Premier League, La Liga, Serie A, Brasileirão, Chilean Primera, Turkish Super Lig, Allsvenskan, Eredivisie, Ligue 2, Primeira Liga, club friendlies, NCAA men/women, Copa Bolivia, AFC Champions League, Argentine leagues, Uruguayan league, and more.

**NOTE:** The `leagues` array in the response from `all` is minimal (just `[{"calendar":[]}]`). The actual league info is embedded in each `event` via:
- `event.season.slug` — e.g. `"2026-27-english-premier-league"`
- `event.competitions[].altGameNote` — human-readable league name e.g. `"English Premier League"`

---

## 🔥 Finding #2: Complete League Discovery — 218 leagues available!

**URL:**
```
GET https://sports.core.api.espn.com/v2/sports/soccer/leagues
```

Returns **218 leagues** across **9 pages** (`pageSize=25`, `page=1..9`).

**Pagination:**
```
?page=1&pageSize=25  —  page 1 of 9
?page=2&pageSize=25  —  page 2 of 9
...
?page=9&pageSize=25  —  page 9 of 9 (18 items)
```

**League ID format (Examples):**
| League ID          | Name                      |
|--------------------|---------------------------|
| `eng.1`            | English Premier League    |
| `esp.1`            | La Liga                   |
| `ita.1`            | Serie A                   |
| `ger.1`            | Bundesliga                |
| `fra.1`            | Ligue 1                   |
| `uefa.champions`   | UEFA Champions League     |
| `uefa.europa`      | UEFA Europa League        |
| `fifa.world`       | FIFA World Cup            |
| `usa.1`            | MLS                       |
| `bra.1`            | Brasileirão Série A       |
| `mex.1`            | Liga MX                   |
| `ned.1`            | Eredivisie                |
| `por.1`            | Primeira Liga             |
| ...and 206 more   |                           |

**All 218 league IDs were extracted and saved below.**

### League ID Mapping to Site API

League IDs from the **core API** (`sports.core.api.espn.com`) map **directly** to the **site API** (`site.api.espn.com`):

```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/{leagueId}/scoreboard
```

Confirmed working: `eng.1`, `esp.1`, `ita.1`, `uefa.champions`, `fifa.world`

---

## 🔥 Finding #3: `sports.core.api.espn.com/v2/sports` — All Sports

**URL:**
```
GET https://sports.core.api.espn.com/v2/sports
```

Returns **17 sports** (australian-football, baseball, basketball, boxing, college-baseball, college-basketball, college-football, cricket, football, golf, hockey, mma, racing, rugby, soccer, tennis, volleyball).

Each sport has its own `/leagues` endpoint:
```
GET https://sports.core.api.espn.com/v2/sports/{sport}/leagues
```

---

## 🔥 Finding #4: Single Sport Level — Does NOT list all leagues

```
GET https://sports.core.api.espn.com/v2/sports/soccer
```

This returns the sport metadata with a `leagues` key, but it only contains **1 reference** (not the full list). The full list is at `/v2/sports/soccer/leagues`.

---

## Recommendations for PronosBot

### Option A: SIMPLEST — Use the `all` endpoint (RECOMMENDED)

```python
url = "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard"
# Optional: date filter
url = "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=20260831&limit=500"
```

**Pros:** Single API call, no league iteration needed, returns everything.
**Cons:** The `all` endpoint returns a minimal `leagues` array; league identity is embedded per-event.
**Verdict:** This is the simplest and most efficient approach.

### Option B: Dynamically Discover Leagues + Per-League Calls

```python
# Step 1: Discover all leagues
import requests
leagues = []
for page in range(1, 10):
    resp = requests.get(
        f"https://sports.core.api.espn.com/v2/sports/soccer/leagues?page={page}&pageSize=25"
    )
    data = resp.json()
    for item in data['items']:
        ref = item['$ref']
        league_id = ref.split('/leagues/')[1].split('?')[0]
        leagues.append(league_id)

# Step 2: Filter to only "major" leagues if desired
# (or just call all 218 — but that's expensive)

# Step 3: Call per-league scoreboard
for lid in leagues:
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{lid}/scoreboard"
    # ... fetch events
```

**Pros:** Full control, per-league data, can filter.
**Cons:** 218 API calls for all leagues.

### Option C: Hybrid — Use `all` for global view + Per-league for details

Use the `all` endpoint to get today's events, then for specific leagues, pass the league ID derived from `event.season.slug`.

---

## Complete League ID List (218 leagues)

```
fifa.world
fifa.wwc
uefa.champions
eng.1
eng.fa
eng.league_cup
esp.1
eng.charity
esp.super_cup
esp.copa_del_rey
usa.1
concacaf.leagues.cup
campeones.cup
usa.nwsl
usa.nwsl.cup
fifa.shebelieves
fifa.w.champions_cup
uefa.wchampions
uefa.europa
uefa.europa.conf
fifa.friendly
mex.1
ger.1
ger.playoff.relegation
ger.dfb_pokal
ita.1
ita.coppa_italia
fra.1
fra.super_cup
ita.super_cup
ger.super_cup
eng.w.1
eng.2
eng.w.promotion.relegation
ned.1
por.1
fra.coupe_de_france
usa.open
ksa.1
club.friendly
conmebol.libertadores
concacaf.champions
fifa.worldq.uefa
fifa.wcq.ply
fifa.worldq.concacaf
fifa.worldq.afc
fifa.worldq.caf
fifa.worldq.conmebol
fifa.worldq.ofc
uefa.nations
fifa.friendly.w
fifa.wworldq.uefa
fifa.wwcq.ply
uefa.w.nations
usa.w.usl.1
uefa.champions_qual
uefa.wchampions_qual
eng.w.fa
eng.w.league_cup
esp.w.1
esp.copa_de_la_reina
fra.w.1
ned.cup
sco.1
sco.tennents
sco.cis
aus.1
aus.w.1
ksa.kings.cup
por.taca.portugal
tur.1
caf.nations
afc.champions
afc.cup
fifa.cwc
fifa.olympics
fifa.w.olympics
concacaf.gold
concacaf.gold_qual
concacaf.w.gold
concacaf.nations.league
concacaf.confederations_playoff
concacaf.w.champions_cup
concacaf.womens.championship
uefa.euro
uefa.euroq
uefa.weuro
uefa.euro_u21
uefa.super_cup
conmebol.america
conmebol.america.femenina
usa.usl.1
usa.usl.l1
usa.usl.l1.cup
mex.2
global.finalissima
global.u20.intercontinental_cup
global.w.finalissima
fifa.world.u20
afc.asian.cup
afc.w.asian.cup
afc.cupq
aff.championship
caf.nations_qual
caf.w.nations
caf.championship
can.w.nsl
uefa.europa_qual
uefa.europa.conf_qual
uefa.w.europa
fifa.intercontinental_cup
afc.champions_qual
afc.cup_qual
nonfifa
rus.1
rus.1.promotion.relegation
bel.1
bel.promotion.relegation
esp.2
ger.2
ita.2
fra.1.promotion.relegation
fra.2
por.1.promotion.relegation
aut.1
gre.1
chn.1
global.club_challenge
ned.supercup
global.pinatar_cup
friendly.emirates_cup
esp.joan_gamper
jpn.world_challenge
global.arnold.clark_cup
fifa.conmebol.olympicsq
fifa.concacaf.olympicsq
fifa.w.concacaf.olympicsq
fifa.world.u17
fifa.wworld.u17
uefa.euro_u21_qual
uefa.euro.u19
fifa.friendly_u21
ger.2.promotion.relegation
eng.trophy
eng.3
eng.4
eng.5
eng.fa_qual
sco.1.promotion.relegation
sco.2
sco.2.promotion.relegation
sco.challenge
sco.tennents_qual
ned.playoff.relegation
ned.2
ned.3.promotion.relegation
ned.w.knvb_cup
ned.w.1
swe.1
swe.1.promotion.relegation
den.1
nor.1.promotion.relegation
nor.1
conmebol.sudamericana
conmebol.recopa
arg.1
arg.copa
arg.copa_de_la_superliga
arg.trofeo_de_la_campeones
arg.2
arg.supercopa
arg.supercopa.internacional
arg.3
bra.supercopa_do_brazil
bra.1
bra.2
bra.copa_do_brazil
bra.camp.carioca
bra.camp.paulista
bra.camp.gaucho
bra.camp.mineiro
chi.super_cup
chi.1
chi.1.promotion.relegation
chi.copa_chi
uru.1
uru.2
col.superliga
col.1
col.copa
per.1
par.1
par.1.supercopa
ecu.1
ven.1
bol.ply.rel
bol.copa
bol.1
jpn.1
mex.campeon
concacaf.central.american.cup
concacaf.champions_cup
concacaf.u23
hon.1
crc.1
gua.1
slv.1
fifa.intercontinental.cup
afc.saff.championship
chn.1.promotion.relegation
ind.1
global.gulf_cup
caf.cosafa
caf.champions
caf.confed
rsa.1
usa.ncaa.m.1
usa.ncaa.w.1
```

---

## Sources

- GitHub: [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API)
- Gist: [ESPN hidden API Docs](https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b)
- Core API: `https://sports.core.api.espn.com/v2/sports/soccer/leagues`
- Site API: `https://site.api.espn.com/apis/site/v2/sports/soccer/{leagueId}/scoreboard`
- Site API (all): `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard`