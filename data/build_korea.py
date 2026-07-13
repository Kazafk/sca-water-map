"""
Build data/world/south_korea_water_quality.json from the statutory monthly
water-quality tests of Korean purification plants (data.go.kr dataset
15093930, published by K-water but covering ~420 plants of 129 operators
nationwide, including the metropolitan waterworks).

SCA-relevant columns of the 60-item statutory panel:
  gyeongdo (hardness, mg/L CaCO3) -> Ca_Hardness_dH (/17.848)
  suso-ion-nongdo (pH), yeomso-ion (chloride mg/L),
  jeungbal-janryumul (total dissolved solids mg/L)
(no sodium in the Korean statutory panel; no alkalinity either)

Attribution plant -> city: the operator (sudo-saeopja) when it names a
si/gun (metros run plants located OUTSIDE their boundary, e.g. Seoul's
Gangbuk plant sits in Namyangju); the plant address (sojaeji) for K-water
and province-level operators.

Korean names are translated to GeoNames primary names through the hangul
alternatenames of cities500 (small rural gun are dropped when absent).

Output: tap-water-db format [{Region: "City (South Korea)", Parameters}].
The raw CSV is cached in data/korea/ (gitignored).
"""
import csv
import json
import os
import re
import statistics
import urllib.request

_HERE     = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(_HERE, "korea")
CSV_FILE  = os.path.join(CACHE_DIR, "kwater_statutory.csv")
GEONAMES  = os.path.join(_HERE, "geonames", "cities500.txt")
OUT_JSON  = os.path.join(_HERE, "world", "south_korea_water_quality.json")

CSV_URL = ("https://www.data.go.kr/cmm/cmm/fileDownload.do"
           "?atchFileId=FILE_000000003206994&fileDetailSn=1")

# CSV columns (fixed statutory layout)
COL_OPERATOR, COL_FACILITY, COL_ADDRESS = 1, 2, 3
COL_HARDNESS, COL_PH, COL_CHLORIDE, COL_TDS = 40, 47, 49, 50

_HANGUL = re.compile(r"[가-힯]")
# suffixes administratifs, du plus long au plus court
_SUFFIXES = ("특별자치시", "특별자치도", "특별시", "광역시", "시", "군")

os.makedirs(CACHE_DIR, exist_ok=True)


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def locality_from(text: str):
    """First si/gun token of an operator or address string, suffix stripped.
    Returns (name, kind) with kind 'si' or 'gun', or None."""
    for token in text.split():
        for suf in _SUFFIXES:
            if token.endswith(suf) and len(token) > len(suf):
                base = token[: -len(suf)]
                if suf.endswith("도"):   # province, keep scanning
                    break
                return base, ("gun" if suf == "군" else "si")
    return None


# --- 1. CSV (cached) ---
if not os.path.exists(CSV_FILE) or os.path.getsize(CSV_FILE) < 100_000:
    print("Downloading statutory water-quality CSV (data.go.kr)...")
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    with open(CSV_FILE, "wb") as f:
        f.write(raw)

with open(CSV_FILE, encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)
print(f"CSV rows: {len(rows)}, plants: {len({r[COL_FACILITY] for r in rows})}")

# --- 2. Aggregate values per Korean locality name ---
by_city = {}
unattributed = 0
for r in rows:
    loc = locality_from(r[COL_OPERATOR]) or locality_from(r[COL_ADDRESS])
    if loc is None:
        unattributed += 1
        continue
    name = loc[0]
    slot = by_city.setdefault(name, {"hard": [], "ph": [], "cl": [], "tds": []})
    for key, col in (("hard", COL_HARDNESS), ("ph", COL_PH),
                     ("cl", COL_CHLORIDE), ("tds", COL_TDS)):
        v = num(r[col])
        if v is not None:
            slot[key].append(v)
print(f"Localities: {len(by_city)} (rows without locality: {unattributed})")

# --- 3. Hangul -> GeoNames primary name ---
hangul_to_en = {}
with open(GEONAMES, encoding="utf-8") as f:
    for line in f:
        t = line.rstrip("\n").split("\t")
        if t[8] != "KR":
            continue
        pop = int(t[14] or 0)
        for alt in t[3].split(","):
            if _HANGUL.search(alt):
                # strip any admin suffix in the alternatename too
                for suf in _SUFFIXES:
                    if alt.endswith(suf) and len(alt) > len(suf):
                        alt = alt[: -len(suf)]
                        break
                prev = hangul_to_en.get(alt)
                if prev is None or pop > prev[1]:
                    hangul_to_en[alt] = (t[1], pop)

# --- 4. Emit tap-water-db entries (median per city) ---
entries = []
unmatched = []
for name, vals in sorted(by_city.items()):
    en = hangul_to_en.get(name)
    if en is None:
        unmatched.append(name)
        continue
    params = {}
    if vals["hard"]:
        params["Ca_Hardness_dH"] = round(statistics.median(vals["hard"]) / 17.848, 4)
    if vals["ph"]:
        params["pH"] = round(statistics.median(vals["ph"]), 2)
    if vals["tds"]:
        params["TDS_Conductivity_uS_cm"] = round(statistics.median(vals["tds"]), 1)
    if vals["cl"]:
        params["Chlorides_Cl_mg_l"] = round(statistics.median(vals["cl"]), 2)
    if "Ca_Hardness_dH" not in params or len(params) < 3:
        continue
    entries.append({"Region": f"{en[0]} (South Korea)", "Parameters": params})

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=1, ensure_ascii=False)
print(f"Wrote {OUT_JSON}: {len(entries)} cities "
      f"({len(unmatched)} localities without GeoNames match)")
