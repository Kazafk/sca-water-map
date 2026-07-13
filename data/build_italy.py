"""
Build data/world/italy_gestori_water_quality.json by scraping the
'etichetta dell'acqua' publications of Italian water utilities (gestori).

Italy has no national open-data source for tap-water chemistry; each gestore
publishes average values per comune. This script hosts one collector per
gestore and merges their output:

  - SAL (Societa Acqua Lodigiana) - province of Lodi, ~60 comuni, one PDF
    per comune with the full label (Durezza deg F, Bicarbonato, Calcio, pH,
    Conducibilita, Sodio, Cloruri, Residuo fisso).
  - Hera (Emilia-Romagna, Veneto, Marche) - 178 comuni, read from the
    SQLite DB shipped inside the Acquologo Android app (table
    dati_qualita_acqua joined with comuni). The DB is committed as
    data/italy/acquologo.sqlite (small, static reference data).

Other gestori (Gruppo CAP, SMAT, Acea, AQP, Abbanoa...) publish via JS apps
or vector-graphic reports and need dedicated future collectors.

Output: tap-water-db format [{Region: "Comune (Italy)", Parameters}].
Downloads cached in data/italy/ (gitignored). Idempotent.
"""
import json
import os
import re
import sqlite3
import time
import urllib.request

from pypdf import PdfReader

_HERE     = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(_HERE, "italy")
OUT_JSON  = os.path.join(_HERE, "world", "italy_gestori_water_quality.json")

os.makedirs(CACHE_DIR, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (sca-water-map)"}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------
# SAL — Societa Acqua Lodigiana (province of Lodi)
# --------------------------------------------------------------------------
SAL_PAGE = "https://www.acqualodigiana.it/etichetta-dellacqua/"

# "<label> <unit> <value> <norm> <freq>" — value = first number after unit
SAL_ROWS = [
    (r"^Durezza\s+°F\s+([\d,\.]+)",              "Ca_Hardness_dH",         10 / 17.848),
    (r"^Bicarbonato\s+mg/L\s+([\d,\.]+)",        "Alkalinity_TAC_mmol_l",  1 / 61.02),
    (r"^Calcio\s+mg/l\s+Ca\s+([\d,\.]+)",        "Calcium_Ca_mg_l",        1.0),
    (r"^pH\s+unità pH\s+([\d,\.]+)",             "pH",                     1.0),
    (r"^Conducibilità\s+µS/cm.*?([\d,\.]+)\s",   "TDS_Conductivity_uS_cm", 1.0),
    (r"^Sodio\s+mg/l\s+Na\s+([\d,\.]+)",         "Sodium_Na_mg_l",         1.0),
    (r"^Clorur[oi]\s+mg/l\s+Cl\s+([\d,\.]+)",    "Chlorides_Cl_mg_l",      1.0),
]


def collect_sal():
    page = fetch(SAL_PAGE).decode("utf-8", errors="replace")
    # one label PDF per comune: .../uploads/YYYY/MM/<Comune>_<year>[_n].pdf
    links = sorted(set(re.findall(
        r'href="(https://www\.acqualodigiana\.it/wp/wp-content/uploads/[^"]+\.pdf)"', page)))
    out = {}
    for url in links:
        fname = os.path.basename(url)
        m = re.match(r"([A-Za-zÀ-ÿ\-]+)_(\d{4})(?:_\d+)?\.pdf$", fname)
        if not m:
            continue  # certificats, rapports RSE...
        comune = m.group(1).replace("-", " ")
        # garder le PDF le plus récent par comune
        year = int(m.group(2))
        if comune in out and out[comune][0] >= year:
            continue
        out[comune] = (year, url)

    entries = {}
    for comune, (year, url) in sorted(out.items()):
        cache = os.path.join(CACHE_DIR, f"sal_{re.sub(r'[^a-z0-9]', '', comune.lower())}.pdf")
        if not os.path.exists(cache) or os.path.getsize(cache) < 5_000:
            try:
                with open(cache, "wb") as f:
                    f.write(fetch(url))
                time.sleep(0.15)
            except Exception as e:
                print(f"  SAL PDF KO {comune}: {e}")
                continue
        try:
            text = "\n".join(pg.extract_text() or "" for pg in PdfReader(cache).pages)
        except Exception:
            continue
        params = {}
        for line in text.splitlines():
            for pattern, key, factor in SAL_ROWS:
                m2 = re.search(pattern, line)
                if m2 and key not in params:
                    v = num(m2.group(1))
                    if v is not None:
                        params[key] = round(v * factor, 4)
        if len(params) >= 3:
            entries[comune] = params
    print(f"SAL: {len(entries)} comuni")
    return entries


# --------------------------------------------------------------------------
# Hera — Acquologo app SQLite DB (committed reference file)
# --------------------------------------------------------------------------
HERA_DB = os.path.join(CACHE_DIR, "acquologo.sqlite")


def collect_hera():
    if not os.path.exists(HERA_DB):
        print("Hera: acquologo.sqlite missing, skipped")
        return {}
    con = sqlite3.connect(HERA_DB)
    rows = con.execute("""
        SELECT c.nomecomune, d.durezza, d.con_ioni_idro, d.conduttivita,
               d.sodio, d.cloruro, d.calcio, d.alcalinita_bicarbonati
        FROM dati_qualita_acqua d JOIN comuni c ON d.IdComune = c.id
    """).fetchall()
    con.close()

    entries = {}
    for name, durezza, ph, cond, na, cl, ca, alk_bic in rows:
        p = {}
        d = num(durezza)              # degrees F
        if d is not None:
            p["Ca_Hardness_dH"] = round(d * 10 / 17.848, 4)
        v = num(ph)
        if v is not None:
            p["pH"] = v
        v = num(cond)
        if v is not None:
            p["TDS_Conductivity_uS_cm"] = v
        v = num(na)
        if v is not None:
            p["Sodium_Na_mg_l"] = v
        v = num(cl)
        if v is not None:
            p["Chlorides_Cl_mg_l"] = v
        v = num(ca)
        if v is not None:
            p["Calcium_Ca_mg_l"] = v
        v = num(alk_bic)              # mg/L HCO3 -> mmol/L
        if v is not None:
            p["Alkalinity_TAC_mmol_l"] = round(v / 61.02, 4)
        if len(p) >= 3:
            entries[name.strip()] = p
    print(f"Hera: {len(entries)} comuni")
    return entries


# --------------------------------------------------------------------------
def main():
    all_entries = {}
    all_entries.update(collect_sal())
    all_entries.update(collect_hera())

    out = [{"Region": f"{comune} (Italy)", "Parameters": params}
           for comune, params in sorted(all_entries.items())]
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"Wrote {OUT_JSON}: {len(out)} comuni")


if __name__ == "__main__":
    main()
