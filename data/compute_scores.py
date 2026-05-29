import math
import json
import os
import time
from datetime import datetime, timezone

import requests

BASE_URL = "https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/resultats_dis"

PARAM_CODES = {
    "calcium":      "1374",
    "tac":          "1347",
    "ph":           "1302",
    "conductivite": "1303",
    "na":           "1375",
    "cl":           "1337",
    "cl2":          "1335",
}

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE  = os.path.join(PROJECT_ROOT, "public", "communes.json")


def fetch_latest_per_commune(param_code: str) -> dict:
    """Return {code_insee: {nom, value, date}} — most recent measurement per commune."""
    results = {}
    page    = 1

    while True:
        resp = requests.get(BASE_URL, params={
            "code_parametre": param_code,
            "fields": "code_commune,nom_commune,resultat_numerique,date_prelevement",
            "size": 10000,
            "sort": "-date_prelevement",
            "page": page,
        }, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        for item in data.get("data", []):
            code = item.get("code_commune")
            if not code or code in results:
                continue
            val = item.get("resultat_numerique")
            if val is not None:
                results[code] = {
                    "nom":   item.get("nom_commune", ""),
                    "value": float(val),
                    "date":  item.get("date_prelevement", ""),
                }

        if page * 10000 >= data.get("count", 0):
            break
        page += 1
        time.sleep(0.5)

    return results


def convert_params(raw: dict) -> dict:
    """Convert raw Hub'Eau values to SCA units."""
    ca   = raw.get("calcium")
    tac  = raw.get("tac")
    cond = raw.get("conductivite")
    return {
        "ca_hardness": ca   * 2.497 if ca   is not None else None,
        "alkalinity":  tac  * 10.0  if tac  is not None else None,
        "ph":          raw.get("ph"),
        "tds":         cond * 0.65  if cond is not None else None,
        "na":          raw.get("na"),
        "cl":          raw.get("cl"),
        "cl2":         raw.get("cl2"),
    }


def score_range(val, lo, hi, max_lo, max_hi):
    if val is None:
        return None
    if lo <= val <= hi:
        return 1.0
    if val < lo:
        span = lo - max_lo
        return max(0.0, 1.0 - (lo - val) / span) if span > 0 else 0.0
    span = max_hi - hi
    return max(0.0, 1.0 - (val - hi) / span) if span > 0 else 0.0


def score_chart(ca_hardness, alkalinity):
    if ca_hardness is not None and alkalinity is not None:
        d_ca  = abs(ca_hardness - 68) / 85
        d_alk = abs(alkalinity  - 55) / 75
        return max(0.0, 1.0 - math.sqrt(d_ca**2 + d_alk**2) / math.sqrt(2))
    if ca_hardness is not None:
        return max(0.0, 1.0 - abs(ca_hardness - 68) / 85)
    if alkalinity  is not None:
        return max(0.0, 1.0 - abs(alkalinity  - 55) / 75)
    return None


def _score_cl2(val):
    if val is None:
        return None
    return max(0.0, min(1.0, 1.0 - val / 0.5))


def score_final(params: dict):
    sc = score_chart(params.get("ca_hardness"), params.get("alkalinity"))
    if sc is None:
        return None

    secondaries = [
        (score_range(params.get("ph"),  6.5,  7.5,  0,   14), 0.08),
        (score_range(params.get("tds"),  75,  250,  0,  500), 0.06),
        (score_range(params.get("na"),    0,   30,  0,  100), 0.03),
        (score_range(params.get("cl"),    0,   75,  0,  200), 0.02),
        (_score_cl2(params.get("cl2")),                        0.01),
    ]

    avail   = [(s, w) for s, w in secondaries if s is not None]
    total_w = sum(w for _, w in avail)
    sec     = sum(s * w for s, w in avail) / total_w if total_w > 0 else 0.0

    return round(min(1.0, max(0.0, 0.80 * sc + 0.20 * sec)), 4)


def build_communes_json() -> dict:
    print("Fetching Hub'Eau data...")
    raw_data: dict[str, dict] = {}

    for key, code in PARAM_CODES.items():
        print(f"  → {key} ({code})...")
        raw_data[key] = fetch_latest_per_commune(code)
        time.sleep(1.0)

    all_communes: dict[str, str] = {}
    for key, cm in raw_data.items():
        for code, info in cm.items():
            if code not in all_communes:
                all_communes[code] = info["nom"]

    print(f"Scoring {len(all_communes)} communes...")
    output = []

    for code, nom in all_communes.items():
        raw    = {k: raw_data[k].get(code, {}).get("value") for k in PARAM_CODES}
        dates_raw = {k: raw_data[k].get(code, {}).get("date")  for k in PARAM_CODES}
        params = convert_params(raw)
        dates  = {
            "ca_hardness": dates_raw.get("calcium"),
            "alkalinity":  dates_raw.get("tac"),
            "ph":          dates_raw.get("ph"),
            "tds":         dates_raw.get("conductivite"),
            "na":          dates_raw.get("na"),
            "cl":          dates_raw.get("cl"),
            "cl2":         dates_raw.get("cl2"),
        }
        output.append({
            "insee": code,
            "nom":   nom,
            "score": score_final(params),
            "params": params,
            "dates":  dates,
        })

    return {
        "communes":     output,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    data = build_communes_json()
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"✓ {len(data['communes'])} communes → {OUTPUT_FILE}")
