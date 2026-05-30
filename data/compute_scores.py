import math
import json
import os
import time
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

BASE_URL       = "https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/resultats_dis"
UDI_URL        = "https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/communes_udi"

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
LOOKBACK_DAYS    = 180


def _log(msg):
    print(msg, flush=True)


def _get_with_retry(params, url=BASE_URL, retries=4, timeout=60):
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
            if attempt == retries - 1:
                raise
            wait = 5 * 2 ** attempt
            _log(f"    timeout, retry in {wait}s...")
            time.sleep(wait)


def fetch_communes_udi() -> dict:
    """Return {code_commune: {code_reseau: nom_reseau}} for current year."""
    results = {}
    page    = 1
    year    = datetime.now(timezone.utc).year

    while True:
        data = _get_with_retry({
            "annee":  year,
            "fields": "code_commune,code_reseau,nom_reseau",
            "size":   10000,
            "page":   page,
        }, url=UDI_URL)

        for item in data.get("data", []):
            code   = item.get("code_commune")
            reseau = item.get("code_reseau")
            nom    = item.get("nom_reseau", "")
            if code and reseau:
                results.setdefault(code, {})[reseau] = nom

        count = data.get("count", 0)
        total = math.ceil(count / 10000) if count else 1
        _log(f"  [communes_udi] page {page}/{total} — {len(results)} communes")
        if page >= total:
            break
        page += 1
        time.sleep(0.3)

    _log(f"  [communes_udi] done — {len(results)} communes mappées")
    return results


def fetch_all_per_commune(key_and_code: tuple) -> tuple:
    """Returns (key, commune_index, reseau_index).

    commune_index: {code_commune: {nom, measurements: [{v,d,l,cp}]}}
    reseau_index:  {code_reseau:  {nom, measurements: [{v,d,l,cp}]}}
    """
    key, param_code = key_and_code
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    commune_idx = {}
    reseau_idx  = {}
    page        = 1

    while True:
        data = _get_with_retry({
            "code_parametre":       param_code,
            "fields":               "code_commune,nom_commune,resultat_numerique,"
                                    "date_prelevement,nom_uge,code_prelevement,reseaux",
            "size":                 10000,
            "date_min_prelevement": since,
            "page":                 page,
        })

        count       = data.get("count", 0)
        total_pages = math.ceil(count / 10000) if count else 1

        for item in data.get("data", []):
            code = item.get("code_commune")
            val  = item.get("resultat_numerique")
            if not code or val is None:
                continue

            m = {
                "v":  round(float(val), 3),
                "d":  (item.get("date_prelevement") or "")[:10],
                "l":  item.get("nom_uge") or "",
                "cp": item.get("code_prelevement") or "",
            }

            # Index by commune
            if code not in commune_idx:
                commune_idx[code] = {"nom": item.get("nom_commune", ""), "measurements": []}
            commune_idx[code]["measurements"].append(m)

            # Index by reseau
            for r in (item.get("reseaux") or []):
                rc = r.get("code")
                if rc:
                    if rc not in reseau_idx:
                        reseau_idx[rc] = {"nom": r.get("nom", ""), "measurements": []}
                    reseau_idx[rc]["measurements"].append(m)

        _log(f"  [{key}] page {page}/{total_pages} — {len(commune_idx)} communes")
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.3)

    n_mesures = sum(len(v["measurements"]) for v in commune_idx.values())
    _log(f"  [{key}] done — {len(commune_idx)} communes, {n_mesures} mesures, {len(reseau_idx)} réseaux")
    return key, commune_idx, reseau_idx


def _avg(values):
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def _avg_from(index, code):
    """Average value from a commune or reseau index entry."""
    entry = index.get(code)
    if not entry or not entry["measurements"]:
        return None, None
    ms = entry["measurements"]
    return _avg([m["v"] for m in ms]), max(m["d"] for m in ms)


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

    raw_commune: dict[str, dict] = {}  # key -> commune_idx
    raw_reseau:  dict[str, dict] = {}  # key -> reseau_idx
    commune_udi: dict            = {}  # code_commune -> {code_reseau: nom}

    with ThreadPoolExecutor(max_workers=8) as executor:
        param_futures = {
            executor.submit(fetch_all_per_commune, item): item[0]
            for item in PARAM_CODES.items()
        }
        udi_future = executor.submit(fetch_communes_udi)

        all_futures = list(param_futures.keys()) + [udi_future]
        completed   = 0

        for future in as_completed(all_futures):
            if future is udi_future:
                commune_udi = future.result()
                _log(f"[udi] communes_udi complete — {len(commune_udi)} communes")
            else:
                key, c_idx, r_idx = future.result()
                raw_commune[key] = c_idx
                raw_reseau[key]  = r_idx
                completed += 1
                _log(f"[{completed}/7] {key} complete")

    # Union of all communes (direct measurements)
    all_communes: dict[str, str] = {}
    for cm in raw_commune.values():
        for code, info in cm.items():
            if code not in all_communes:
                all_communes[code] = info["nom"]

    total = len(all_communes)
    _log(f"Scoring {total} communes (with UDI fallback)...")
    output        = []
    udi_fallbacks = 0

    for i, (code, nom) in enumerate(all_communes.items(), 1):
        if i % 1000 == 0:
            _log(f"  {i}/{total} ({100*i//total}%) — {udi_fallbacks} fallbacks UDI")

        raw_avgs   = {}
        raw_latest = {}
        fallback   = {}  # param -> reseau_nom

        # Pass 1: direct commune measurements
        for k in PARAM_CODES:
            val, date = _avg_from(raw_commune[k], code)
            raw_avgs[k]   = val
            raw_latest[k] = date

        # Pass 2: UDI fallback for calcium and TAC if missing
        if raw_avgs.get("calcium") is None or raw_avgs.get("tac") is None:
            for reseau_code, reseau_nom in commune_udi.get(code, {}).items():
                for k in ("calcium", "tac"):
                    if raw_avgs.get(k) is None:
                        val, date = _avg_from(raw_reseau[k], reseau_code)
                        if val is not None:
                            raw_avgs[k]   = val
                            raw_latest[k] = date
                            fallback[k]   = reseau_nom

        if fallback:
            udi_fallbacks += 1

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

        # chart_points: join Ca + TAC by code_prelevement
        # Use reseau measurements if commune has none for that param
        ca_ms  = raw_commune["calcium"].get(code, {}).get("measurements", [])
        tac_ms = raw_commune["tac"].get(code, {}).get("measurements", [])

        # UDI fallback for chart points if commune has no direct Ca/TAC
        if not ca_ms and "calcium" in fallback:
            for rc in commune_udi.get(code, {}):
                ca_ms = raw_reseau["calcium"].get(rc, {}).get("measurements", [])
                if ca_ms:
                    break
        if not tac_ms and "tac" in fallback:
            for rc in commune_udi.get(code, {}):
                tac_ms = raw_reseau["tac"].get(rc, {}).get("measurements", [])
                if tac_ms:
                    break

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
        if fallback:
            # Store first reseau name for display (calcium > tac)
            entry["reseau"] = fallback.get("calcium") or fallback.get("tac")

        output.append(entry)

    _log(f"UDI fallback appliqué à {udi_fallbacks} communes ({100*udi_fallbacks//total}%)")
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
