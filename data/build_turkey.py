"""
Build data/world/turkey_water_quality.json from the official monthly network
analyses published by Turkish metropolitan water utilities.

Currently covered: ASKI (Ankara) - the only major utility both reachable from
outside Turkey and machine-readable (ISKI Istanbul is geo-blocked; the other
buyuksehir utilities hide their reports behind JS). The TS266 statutory panel
has NO hardness, so Ankara receives a capped degraded score (hatched on the
map) until a richer source is found.

The ASKI page lists one PDF per month per standard; we parse the TS 266 one:
lines "<Parametre> <unit> <value> <norm>".

Output: tap-water-db format [{Region: "Ankara (Turkey)", Parameters}].
PDFs cached in data/turkey/ (gitignored).
"""
import json
import os
import re
import urllib.request

from pypdf import PdfReader

_HERE     = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(_HERE, "turkey")
OUT_JSON  = os.path.join(_HERE, "world", "turkey_water_quality.json")

ASKI_PAGE = "https://www.aski.gov.tr/tr/suanalizsonuclari.aspx"

os.makedirs(CACHE_DIR, exist_ok=True)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


# --- latest TS266 monthly PDF from the ASKI page ---
page = fetch(ASKI_PAGE).decode("utf-8", errors="replace")
pdfs = re.findall(r'href="(/Yukle/Dosya/SuAnalizSonuclari/[^"]*TS266\.pdf)"', page)
if not pdfs:
    raise SystemExit("ASKI: no TS266 PDF link found")
pdf_url = "https://www.aski.gov.tr" + pdfs[0]
cache = os.path.join(CACHE_DIR, os.path.basename(pdf_url))
if not os.path.exists(cache):
    with open(cache, "wb") as f:
        f.write(fetch(pdf_url))

text = "\n".join(pg.extract_text() or "" for pg in PdfReader(cache).pages)

# "<label> <unit> <value> <norm>" -> first number after the label/unit
ROWS = [
    (r"^pH\s+([\d,\.]+)",                                    "pH"),
    (r"^Elektriksel İletkenlik.*?µS/cm[ ,]*([\d\.]+,?\d*)",  "TDS_Conductivity_uS_cm"),
    (r"^Klorür mg/l\s+([\d,\.]+)",                           "Chlorides_Cl_mg_l"),
    (r"^Sodyum mg/l\s+([\d,\.]+)",                           "Sodium_Na_mg_l"),
]

params = {}
for line in text.splitlines():
    for pattern, key in ROWS:
        m = re.search(pattern, line)
        if m and key not in params:
            # turkish formatting: 1.041,5 or 1041 or 168,20
            v = m.group(1).replace(".", "").replace(",", ".") if "," in m.group(1) \
                else m.group(1)
            try:
                params[key] = round(float(v), 2)
            except ValueError:
                pass

if len(params) < 3:
    raise SystemExit(f"ASKI: incomplete parse: {params}")

# pycountry (recent) only knows the country as "Türkiye"
entries = [{"Region": "Ankara (Türkiye)", "Parameters": params}]
with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=1, ensure_ascii=False)
print(f"Wrote {OUT_JSON}: {entries[0]['Parameters']} (source: {os.path.basename(cache)})")
