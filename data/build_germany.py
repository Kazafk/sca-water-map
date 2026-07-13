"""
Build data/world/germany_wikipedia_water_quality.json from the Wikipedia list
'Liste der Trinkwasserversorgung deutscher Grossstaedte': total hardness
(Gesamthaerte, deg dH) for the ~80 German cities above 100 000 inhabitants,
as published by their water utilities (per-row sources on the page).

Hardness is the only SCA parameter available (ranges -> midpoint), which is
enough to compute a score (the chart works without alkalinity, cf. Wallonia);
the entries carry the front-end's "partial data" badge until a proper
importer (Stadtwerke scraping) supersedes them - build_world.py keeps the
richest entry per city, so this file loses automatically to better data.

Output: tap-water-db format [{Region: "Stadt (Germany)", Parameters}].
"""
import html as htmllib
import json
import os
import re
import urllib.request

_HERE    = os.path.dirname(os.path.abspath(__file__))
OUT_JSON = os.path.join(_HERE, "world", "germany_wikipedia_water_quality.json")

WIKI_URL = ("https://de.wikipedia.org/wiki/"
            "Liste_der_Trinkwasserversorgung_deutscher_Gro%C3%9Fst%C3%A4dte")

req = urllib.request.Request(WIKI_URL, headers={"User-Agent": "sca-water-map/1.0"})
with urllib.request.urlopen(req, timeout=60) as r:
    page = r.read().decode("utf-8")

tables = re.findall(r"<table[^>]*wikitable[^>]*>(.*?)</table>", page, re.S)
# tables[0] is the hardness-scale legend; tables[1] is the city list
rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tables[1], re.S)

entries = []
for row in rows:
    cells = [htmllib.unescape(re.sub(r"<[^>]+>|\n", " ", c)).strip()
             for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
    if len(cells) < 3:
        continue
    city = re.sub(r"\s*\(.*\)$", "", cells[0]).strip()
    # "3,0-14,0" (en dash) or "11,0" -> midpoint
    nums = [float(v.replace(",", ".")) for v in re.findall(r"\d+(?:,\d+)?", cells[2])]
    if not city or not nums:
        continue
    hardness = round(sum(nums) / len(nums), 2)
    if not (0.5 <= hardness <= 60):
        continue
    entries.append({"Region": f"{city} (Germany)",
                    "Parameters": {"Ca_Hardness_dH": hardness}})

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=1, ensure_ascii=False)
print(f"Wrote {OUT_JSON}: {len(entries)} cities")
print("Sample:", [(e['Region'].split(' (')[0], e['Parameters']['Ca_Hardness_dH'])
                  for e in entries[:5]])
