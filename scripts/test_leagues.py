#!/usr/bin/env python3
"""Test chaque ligue ESPN pour identifier les IDs incorrects ou les ligues sans matchs."""
import json
import urllib.request
from datetime import datetime, timedelta

# Calcule la plage de dates (aujourd'hui + 7 jours)
today = datetime.utcnow()
dates_str = today.strftime("%Y%m%d") + "-" + (today + timedelta(days=7)).strftime("%Y%m%d")

LEAGUES = {
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
    "bra.carioca": "Coupe de Rio",
    "usa.1": "MLS",
    "usa.mlsnp": "MLS Next Pro",
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
}

print(f"=== Test ESPN (semaine {dates_str[:8]} → {dates_str[9:]}) ===\n")

working = []
broken = []
empty = []

for league_id, name in LEAGUES.items():
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_id}/scoreboard?dates={dates_str}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PronoBot-Test/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            count = len(data.get("events", []))
            if count == 0:
                print(f"⬜ {name:<24} [{league_id:<18}] 0 match (hors-saison?)")
                empty.append((league_id, name))
            else:
                print(f"✅ {name:<24} [{league_id:<18}] {count} matchs")
                working.append((league_id, name, count))
    except urllib.error.HTTPError as e:
        print(f"❌ {name:<24} [{league_id:<18}] HTTP {e.code} — ID INCORRECT?")
        broken.append((league_id, name, f"HTTP {e.code}"))
    except Exception as e:
        print(f"⚠️  {name:<24} [{league_id:<18}] Erreur: {str(e)[:60]}")
        broken.append((league_id, name, str(e)[:60]))

print(f"\n=== RÉSUMÉ ===")
print(f"✅ Ligues avec matchs: {len(working)}")
print(f"⬜ Ligues sans matchs (hors-saison): {len(empty)}")
print(f"❌ Ligues avec ID incorrect: {len(broken)}")

if broken:
    print(f"\n❌ IDS À CORRIGER:")
    for lid, name, err in broken:
        print(f"   - {lid} ({name}): {err}")
