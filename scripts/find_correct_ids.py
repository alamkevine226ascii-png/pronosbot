#!/usr/bin/env python3
"""Cherche les bons IDs ESPN pour les ligues cassées/suspectes."""
import json
import urllib.request

DATES = "20260801-20260831"

# Tests d'IDs alternatifs pour les ligues cassées ou suspectes
TESTS = {
    # Serie B italienne (ita.2 = 0 match, suspect)
    "ita.2": "Serie B (actuel)",
    "ita.series_b": "Serie B v2",
    "ita.b": "Serie B v3",
    # Süper Lig turque (tur.1 = 0 match, suspect)
    "tur.1": "Süper Lig (actuel)",
    "tur.super_lig": "Süper Lig v2",
    "tur.superlig": "Süper Lig v3",
    # Coupe de Rio (bra.carioca = HTTP 400)
    "bra.carioca": "Coupe de Rio (actuel - CASSÉ)",
    "bra.copa": "Coupe Brésil v2",
    "bra.cup": "Coupe Brésil v3",
    # MLS Next Pro (usa.mlsnp = HTTP 400)
    "usa.mlsnp": "MLS Next Pro (actuel - CASSÉ)",
    "usa.mls.next": "MLS Next v2",
    "usa.2": "USA D2 v2",
    # Europa League / Conference (0 match en août — peut-être OK)
    "uefa.europa": "Europa League (actuel)",
    "uefa.europa.league": "Europa League v2",
    # Ligue des Nations (0 match — peut-être OK)
    "uefa.nations": "Ligue des Nations (actuel)",
    "uefa.nations.league": "Ligue des Nations v2",
    # Copa Libertadores (déjà confirmé OK)
    "conmebol.libertadores": "Copa Libertadores ✅",
    # FA Cup (0 match en août — OK, commence en novembre)
    "eng.fa": "FA Cup (actuel)",
    "eng.facup": "FA Cup v2",
    # Cup International test
    "fifa.u20": "FIFA U20 World Cup",
    "fifa.u17": "FIFA U17 World Cup",
    "fifa.confederations": "Coupe Confédérations",
    "concacaf.gold": "Gold Cup",
}

print(f"=== Test IDs alternatifs (août {DATES}) ===\n")

for league_id, name in TESTS.items():
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_id}/scoreboard?dates={DATES}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PronoBot-Test/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            count = len(data.get("events", []))
            status = f"✅ {count} matchs" if count > 0 else "⬜ 0 match"
            print(f"{status:<20} {name:<35} [{league_id}]")
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP {e.code:<10} {name:<35} [{league_id}]")
    except Exception as e:
        print(f"⚠️  Erreur        {name:<35} [{league_id}] {str(e)[:40]}")
