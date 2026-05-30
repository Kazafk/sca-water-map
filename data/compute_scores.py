import math
import json
import os
import time
import sys
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

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

MAX_CHART_POINTS = 30
LOOKBACK_DAYS    = 180  # 6 months


def _log(msg):
    print(msg, flush=True)


def _get_with_retry(params, retries=4, timeout=60):
    for attempt in range(retries):
        try:
            resp = requests.get(BASE_URL, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
            if attempt == retries - 1:
                raise
            wait = 5 * 2 ** attempt
            _log(f"    timeout, retry in {wait}s...")
            time.sleep(wait)


def fetch_all_per_commune(key_and_code: tuple) -> tuple:
    """Fetch all measurements for one parameter. Returns (key, results_dict)."""
    key, param_code = key_and_code
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    results = {}
    page    = 1

    while True:
        data = _get_with_retry({
            "code_parametre":       param_code,
            "fields":               "code_commune,nom_commune,resultat_numerique,date_prelevement,nom_uge,code_prelevement",
            "size":                 10000,
            "date_min_prelevement": since,
            "page":                 page,
        })

        count = data.get("count", 0)
        total_pages = math.ceil(count / 10000) if count else 1

        for item in data.get("data", []):
            code = item.get("code_commune")
            val  = item.get("resultat_numerique")
            if not code or val is None:
                continue
            if code not in results:
                results[code] = {"nom": item.get("nom_commune", ""), "measurements": []}
            results[code]["measurements"].append({
                "v":  round(float(val), 3),
                "d":  (item.get("date_prelevement") or "")[:10],
                "l":  item.get("nom_uge") or "",
                "cp": item.get("code_prelevement") or "",
            })

        _log(f"  [{key}] page {page}/{total_pages} — {len(results)} communes")

        if page >= total_pages:
            break
        page += 1
        time.sleep(0.3)

    _log(f"  [{key}] done — {len(results)} communes, {sum(len(v['measurements']) for v in results.values())} mesures")
    return key, results


def _avg(values):
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def convert_params(raw: dict) -> dict:
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
    _log(f"Fetching Hub'Eau data (last {LOOKBACK_DAYS} days, parallel)...")
    raw_data: dict[str, dict] = {}

    # Fetch all 7 parameters in parallel
    with ThreadPoolExecutor(max_workers=7) as executor:
        futures = {executor.submit(fetch_all_per_commune, item): item[0]
                   for item in PARAM_CODES.items()}
        completed = 0
        for future in as_completed(futures):
            key, results = future.result()
            raw_data[key] = results
            completed += 1
            _log(f"[{completed}/7] {key} complete")

    all_communes: dict[str, str] = {}
    for cm in raw_data.values():
        for code, info in cm.items():
            if code not in all_communes:
                all_communes[code] = info["nom"]

    total = len(all_communes)
    _log(f"Scoring {total} communes...")
    output = []

    for i, (code, nom) in enumerate(all_communes.items(), 1):
        if i % 1000 == 0:
            _log(f"  {i}/{total} ({100*i//total}%)")

        raw_avgs   = {}
        raw_latest = {}
        for k in PARAM_CODES:
            commune_data = raw_data[k].get(code)
            if commune_data and commune_data["measurements"]:
                ms = commune_data["measurements"]
                raw_avgs[k]   = _avg([m["v"] for m in ms])
                raw_latest[k] = max(m["d"] for m in ms)
            else:
                raw_avgs[k]   = None
                raw_latest[k] = None

        params = convert_params(raw_avgs)
        dates  = {
            "ca_hardness": raw_latest.get("calcium"),
            "alkalinity":  raw_latest.get("tac"),
            "ph":          raw_latest.get("ph"),
            "tds":         raw_latest.get("conductivite"),
            "na":          raw_latest.get("na"),
            "cl":          raw_latest.get("cl"),
            "cl2":         raw_latest.get("cl2"),
        }

        ca_ms     = raw_data["calcium"].get(code, {}).get("measurements", [])
        tac_ms    = raw_data["tac"].get(code, {}).get("measurements", [])
        tac_by_cp = {m["cp"]: m for m in tac_ms if m["cp"]}

        pts = []
        for m in ca_ms:
            tac_m = tac_by_cp.get(m["cp"]) if m["cp"] else None
            pts.append({
                "ca":  round(m["v"] * 2.497, 1),
                "alk": round(tac_m["v"] * 10.0, 1) if tac_m else None,
                "d":   m["d"],
                "l":   m["l"],
            })

        pts.sort(key=lambda p: p["d"], reverse=True)
        pts = pts[:MAX_CHART_POINTS]

        entry = {
            "insee":  code,
            "nom":    nom,
            "score":  score_final(params),
            "params": params,
            "dates":  dates,
        }
        if pts:
            entry["pts"] = pts

        output.append(entry)

    return {
        "communes":     output,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    t0   = time.time()
    data = build_communes_json()
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    elapsed = round(time.time() - t0)
    _log(f"done: {len(data['communes'])} communes -> {OUTPUT_FILE} ({elapsed}s)")
