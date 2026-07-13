"""
Build data/world/belgium_water_quality.json from official Belgian sources.

Wallonia (this script's core): the SPW publishes one water-quality report per
distribution zone (641 zones, fiches HTML on cartodoc.wallonie.be), indexed by
the ODWB open-data dataset 'zones-de-distribution-en-eau-wallonie' which maps
each zone to its communes. We parse the parameter table of each fiche
(medians over the reporting year) and aggregate per commune (mean across the
zones that serve it).

Output: tap-water-db format list [{Region: "Commune (Belgium)", Parameters}],
ingested by build_world.py (geocoding via GeoNames cities500).

Unit conversions:
  Durete (french degrees, 1 f = 10 mg/L CaCO3) -> Ca_Hardness_dH = f * 10 / 17.848
  Conductivite uS/cm -> TDS_Conductivity_uS_cm (same convention as California)

Fiches are cached in data/wallonie/ (gitignored). Idempotent.
"""
import html as htmllib
import json
import os
import re
import time
import urllib.request

_HERE     = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(_HERE, "wallonie")
OUT_JSON  = os.path.join(_HERE, "world", "belgium_water_quality.json")

ODWB_API = ("https://www.odwb.be/api/explore/v2.1/catalog/datasets/"
            "zones-de-distribution-en-eau-wallonie/records"
            "?select=nom_zde,distributeur,communes,fiche_qualite&limit=100&offset={offset}")

os.makedirs(CACHE_DIR, exist_ok=True)

# Brussels is not covered by the Wallonia fiches; values from Vivaqua's
# published composition (range midpoints), carried over from the original
# tap-water-db "Bruxelles (Vivaqua)" entry.
BRUSSELS = {
    "Region": "Brussels (Belgium)",
    "Parameters": {
        "Ca_Hardness_dH": 16.8,
        "Alkalinity_TAC_mmol_l": 4.5,
        "pH": 7.6,
        "TDS_Conductivity_uS_cm": 550,
        "Sodium_Na_mg_l": 12.0,
        "Chlorides_Cl_mg_l": 20.0,
        "Calcium_Ca_mg_l": 90.0,
    },
}

# fiche row label -> (output parameter, converter)
PARAM_MAP = {
    "durete":       ("Ca_Hardness_dH",         lambda v: round(v * 10 / 17.848, 4)),
    "ph":           ("pH",                      lambda v: v),
    "conductivite": ("TDS_Conductivity_uS_cm",  lambda v: v),
    "sodium":       ("Sodium_Na_mg_l",          lambda v: v),
    "chlorures":    ("Chlorides_Cl_mg_l",       lambda v: v),
}


def _norm(s: str) -> str:
    """Lowercase, strip accents-ish (fiche encoding varies) and non-letters."""
    s = s.lower()
    s = re.sub(r"[éèêë]", "e", s)
    s = re.sub(r"[^a-z]", "", s)
    return s


def fetch_zones():
    zones, offset = [], 0
    while True:
        with urllib.request.urlopen(ODWB_API.format(offset=offset), timeout=60) as r:
            d = json.load(r)
        zones.extend(d["results"])
        offset += 100
        if offset >= d["total_count"]:
            return zones


def fetch_fiche(url: str, name: str):
    cache = os.path.join(CACHE_DIR, f"{name}.html")
    if os.path.exists(cache) and os.path.getsize(cache) > 5_000:
        return open(cache, encoding="utf-8", errors="replace").read()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "sca-water-map/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
    except Exception as e:
        print(f"  fiche KO {name}: {e}")
        return None
    with open(cache, "wb") as f:
        f.write(raw)
    return raw.decode("utf-8", errors="replace")


def parse_fiche(page: str) -> dict:
    """Extract SCA-relevant medians from the fiche's parameter table."""
    params = {}
    for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        cells = [htmllib.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) < 4:
            continue
        key = _norm(cells[0])
        mapped = PARAM_MAP.get(key)
        if not mapped:
            continue
        # standard rows: the median lives in the col-mediane cell (may read
        # "Sous le seuil de quantification" -> param skipped)
        med_cells = re.findall(r"<td class='col-mediane'>(.*?)</td>", row, re.S)
        median = None
        if med_cells:
            c = htmllib.unescape(re.sub(r"<[^>]+>", "", med_cells[0])).strip()
            m = re.fullmatch(r"-?\d+(?:[.,]\d+)?", c)
            if m:
                median = float(m.group(0).replace(",", "."))
        else:
            # 'durete' row uses a graphic layout without col-mediane: take the
            # last numeric cell ("34.5" before the trailing '*')
            for c in cells[1:]:
                m = re.fullmatch(r"-?\d+(?:[.,]\d+)?", c.strip())
                if m:
                    median = float(m.group(0).replace(",", "."))
        if median is None:
            continue
        out_name, conv = mapped
        params[out_name] = conv(median)
    return params


def main():
    zones = fetch_zones()
    print(f"ODWB zones: {len(zones)}")

    by_commune = {}   # commune -> {param: [values]}
    parsed = failed = 0
    for z in zones:
        url = z.get("fiche_qualite")
        communes = z.get("communes") or []
        if not url or not communes:
            continue
        page = fetch_fiche(url, z["nom_zde"])
        if page is None:
            failed += 1
            continue
        params = parse_fiche(page)
        if not params:
            failed += 1
            continue
        parsed += 1
        for commune in communes:
            # "Amel (Ambleve)" -> "Amel"
            name = re.sub(r"\s*\(.*\)$", "", commune).strip()
            slot = by_commune.setdefault(name, {})
            for k, v in params.items():
                slot.setdefault(k, []).append(v)
        time.sleep(0.15)

    print(f"Fiches parsed: {parsed}, failed/empty: {failed}, communes: {len(by_commune)}")

    entries = []
    for name, plists in sorted(by_commune.items()):
        parameters = {k: round(sum(v) / len(v), 4) for k, v in plists.items()}
        if len(parameters) < 3:
            continue
        entries.append({"Region": f"{name} (Belgium)", "Parameters": parameters})

    entries.append(BRUSSELS)

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=1, ensure_ascii=False)
    print(f"Wrote {OUT_JSON}: {len(entries)} communes")


if __name__ == "__main__":
    main()
