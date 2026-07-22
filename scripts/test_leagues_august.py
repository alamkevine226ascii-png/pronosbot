#!/usr/bin/env python3
"""Test les ligues sur une date future (août = pleine saison européenne)."""
import json
import urllib.request
from datetime import datetime, timezone

# Test sur une plage d'un mois en août (pleine saison)
DATES = "20260801-20260831"

# IDs à tester — inclut aussi des alternatives pour les IDs cassés
LEAGUES = {
    # IDs actuels de l'app
    "fifa.world": "Coupe du Monde",
    "uefa.champions": "LDC",
    "uefa.euro": "Euro",
    "fifa.cwc": "CWC",
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ita.1": "Serie A",
    "ger.1": "Bundesliga",
    "fra.1": "Ligue 1",
    "bra.1": "Brésil Série A",
    "bra.2": "Brasileirao B",
    "bra.carioca": "Coupe de Rio (ID actuel - CASSÉ)",
    "usa.1": "MLS",
    "usa.mlsnp": "MLS Next Pro (ID actuel - CASSÉ)",
    "arg.1": "Liga Argentina",
    "chn.1": "Chinese Super League",
    "uefa.europa": "Europa League",
    "uefa.europa.conf": "Conference League",
    "uefa.nations": "Ligue des Nations",
    "eng.2": "Championship",
    "esp.2": "La Liga 2",
    "ita.2": "Serie B",
    "fra.2": "Ligue 2",
    "ned.1": "Eredivisie",
    "por.1": "Liga Portugal",
    "tur.1": "Süper Lig",
    "eng.fa": "FA Cup",
    "eng.league_cup": "EFL Cup",
    "jpn.1": "J1 League",
    # IDs alternatifs à tester pour corriger les 2 cassés
    "bra.carioca.1": "TEST: Coupe de Rio v2",
    "usa.2": "TEST: USL Championship (D2 USA)",
    "usa.usl": "TEST: USL v2",
    "uefa.europa.league": "TEST: Europa League v2",
    "eng.league_cup.carabao": "TEST: EFL Cup v2",
    "conmebol.libertadores": "TEST: Copa Libertadores",
    "mex.1": "TEST: Liga MX (à confirmer)",
}

print(f"=== Test ESPN (août 2026, plage {DATES}) ===\n")

working = []
broken = []
empty = []

for league_id, name in LEAGUES.items():
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_id}/scoreboard?dates={DATES}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PronoBot-Test/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            count = len(data.get("events", []))
            if count == 0:
                print(f"⬜ {name:<38} [{league_id:<22}] 0 match")
                empty.append((league_id, name))
            else:
                print(f"✅ {name:<38} [{league_id:<22}] {count} matchs")
                working.append((league_id, name, count))
    except urllib.error.HTTPError as e:
        print(f"❌ {name:<38} [{league_id:<22}] HTTP {e.code}")
        broken.append((league_id, name, f"HTTP {e.code}"))
    except Exception as e:
        print(f"⚠️  {name:<38} [{league_id:<22}] {str(e)[:50]}")
        broken.append((league_id, name, str(e)[:50]))

print(f"\n=== RÉSUMÉ ===")
print(f"✅ Ligues avec matchs: {len(working)}")
print(f"⬜ Ligues sans matchs: {len(empty)}")
print(f"❌ IDs incorrects: {len(broken)}")
