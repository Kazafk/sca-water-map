"""
Build data/world/netherlands_rivm_water_quality.json from two sources:

1. RIVM INSPIRE WFS 'inspire:drinkwaterkwaliteit': yearly averages measured
   at each drinking-water pumping station (2013-present, ~200 stations, all
   10 companies) - pH, conductivity (mS/m), sodium, chloride + coordinates.
   NO hardness/calcium/alkalinity in this layer.

2. Vitens 'waterkwaliteitsoverzicht' PDFs (one per production station,
   Vewin-style layout): Totale Hardheid (deg D), Waterstofcarbonaat (mg/l),
   Calcium, pH, EGV, Na, Cl. Matched to RIVM stations by normalized name
   to inherit their coordinates.

Only cities whose nearby stations provide hardness are emitted (the SCA
score is 80% driven by the hardness/alkalinity chart; without it the entry
would stay grey on the map). Coverage therefore follows the Vitens area
(Friesland, Overijssel, Gelderland, Utrecht, Flevoland) until other
companies' PDFs are added.

Mapping stations -> cities: every GeoNames NL city (pop >= 10 000) takes the
mean of the stations within ASSIGN_KM, per parameter.

Output: tap-water-db format [{Region: "Ville (Netherlands)", Parameters}].
Downloads are cached in data/rivm/ and data/nl_pdfs/ (gitignored).
"""
import json
import math
import os
import re
import time
import urllib.parse
import urllib.request

from pypdf import PdfReader

_HERE      = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR  = os.path.join(_HERE, "rivm")
PDF_DIR    = os.path.join(_HERE, "nl_pdfs")
CACHE_FILE = os.path.join(CACHE_DIR, "drinkwaterkwaliteit.json")
GEONAMES   = os.path.join(_HERE, "geonames", "cities500.txt")
OUT_JSON   = os.path.join(_HERE, "world", "netherlands_rivm_water_quality.json")

WFS_URL = ("https://data.rivm.nl/geo/inspire/wfs?service=WFS&version=2.0.0"
           "&request=GetFeature&typeNames=inspire:drinkwaterkwaliteit"
           "&count=5000&outputFormat=application/json")
VITENS_PAGE = "https://www.vitens.nl/service/waterkwaliteit/waterkwaliteitsoverzichten"

MIN_POPULATION = 10_000
ASSIGN_KM      = 20.0

os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(PDF_DIR, exist_ok=True)


def rd_to_wgs84(x: float, y: float):
    """RD New (EPSG:28992) -> WGS84, Schreutelkamp approximation (~1 m)."""
    dx = (x - 155000) * 1e-5
    dy = (y - 463000) * 1e-5
    phi = 52.15517440 + (
        3235.65389 * dy - 32.58297 * dx**2 - 0.24750 * dy**2
        - 0.84978 * dx**2 * dy - 0.06550 * dy**3 - 0.01709 * dx**2 * dy**2
        - 0.00738 * dx + 0.00530 * dx**4 - 0.00039 * dx**2 * dy**3
        + 0.00033 * dx**4 * dy - 0.00012 * dx * dy) / 3600
    lam = 5.38720621 + (
        5260.52916 * dx + 105.94684 * dx * dy + 2.45656 * dx * dy**2
        - 0.81885 * dx**3 + 0.05594 * dx * dy**3 - 0.05607 * dx**3 * dy
        + 0.01199 * dy - 0.00256 * dx**3 * dy**2 + 0.00128 * dx * dy**4
        + 0.00022 * dy**2 - 0.00022 * dx**2 + 0.00026 * dx**5) / 3600
    return phi, lam


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def num(v):
    try:
        f = float(str(v).replace(",", "."))
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


# --- 1. RIVM WFS stations (cached) ---
if not os.path.exists(CACHE_FILE) or os.path.getsize(CACHE_FILE) < 500_000:
    print("Downloading RIVM drinkwaterkwaliteit WFS layer...")
    urllib.request.urlretrieve(WFS_URL, CACHE_FILE)
with open(CACHE_FILE, "r", encoding="utf-8") as f:
    wfs = json.load(f)

stations = {}
for feat in wfs["features"]:
    p = feat["properties"]
    name = p.get("pompstationnaam")
    year = num(p.get("jaar"))
    x, y = num(p.get("xcoord")), num(p.get("ycoord"))
    if not name or year is None or x is None or y is None:
        continue
    if name in stations and stations[name]["year"] >= year:
        continue
    params = {
        "pH":                     num(p.get("hydrogen_ion_concentration_ph")),
        "TDS_Conductivity_uS_cm": (num(p.get("conductivity_ms_m")) or 0) * 10 or None,
        "Sodium_Na_mg_l":         num(p.get("sodium_mg_l")),
        "Chlorides_Cl_mg_l":      num(p.get("chloride_mg_l")),
    }
    params = {k: v for k, v in params.items() if v is not None}
    lat, lng = rd_to_wgs84(x, y)
    stations[name] = {"year": year, "lat": lat, "lng": lng, "params": params}
print(f"RIVM stations (latest year): {len(stations)}")

# --- 2. Vitens PDFs: hardness / bicarbonate / calcium (+ the rest) ---
# PDF line layout: "<label> <unit> <mean> <min> <max> <n> [norms...]"
PDF_ROWS = [
    (r"Totale Hardheid\D*?D\s",              "Ca_Hardness_dH",         1.0),
    (r"Waterstofcarbonaat\s+mg/l\s",         "Alkalinity_TAC_mmol_l",  1 / 61.02),
    (r"Calcium \(Ca\), na aanzuren\s+mg/l\s", "Calcium_Ca_mg_l",       1.0),
    (r"Zuurgraad \(pH\)\s+pH\s",             "pH",                     1.0),
    (r"Geleidingsvermogen.*?mS/m\s",         "TDS_Conductivity_uS_cm", 10.0),
    (r"Natrium \(Na\), na aanzuren\s+mg/l\s", "Sodium_Na_mg_l",        1.0),
    (r"Chloride\s+mg/l\s",                   "Chlorides_Cl_mg_l",      1.0),
]


def parse_vitens_pdf(path: str) -> dict:
    """Mean per parameter, averaged over the PDF's report blocks."""
    try:
        text = "\n".join(pg.extract_text() or "" for pg in PdfReader(path).pages)
    except Exception:
        return {}
    acc = {}
    for line in text.splitlines():
        for pattern, out_key, factor in PDF_ROWS:
            m = re.search(pattern + r"([\d,\.]+)", line)
            if m:
                v = num(m.group(1))
                if v is not None:
                    acc.setdefault(out_key, []).append(v * factor)
                break
    return {k: round(sum(v) / len(v), 4) for k, v in acc.items()}


# Brabant Water publishes one quarterly PDF per production station; layout:
# "<label> <unit> [norm] <n> <mean> <min> <max>" -> mean = 3rd number from
# the end. Hardness is 'totale hardheid' in mmol/l (1 mmol/l = 5.6 dH).
BRABANT_PAGE = ("https://www.brabantwater.nl/drinkwater/waterkwaliteit/"
                "kraanwaterkwaliteit/waterkwaliteitsoverzicht-productielocatie")
BRABANT_ROWS = [
    (r"^\s*totale hardheid\s+mmol/l",   "Ca_Hardness_dH",         5.6),
    (r"^\s*waterstofcarbonaat\s+mg/l",  "Alkalinity_TAC_mmol_l",  1 / 61.02),
    (r"^\s*calcium\s+mg/l",             "Calcium_Ca_mg_l",        1.0),
    (r"^\s*zuurgraad\s+pH-eenh",        "pH",                     1.0),
    (r"^\s*EGV \(elek",                 "TDS_Conductivity_uS_cm", 10.0),
    (r"^\s*natrium\s+mg/l",             "Sodium_Na_mg_l",         1.0),
    (r"^\s*chloride\s+mg/l",            "Chlorides_Cl_mg_l",      1.0),
]


def parse_brabant_pdf(path: str) -> dict:
    # extraction_mode='layout' keeps table cells on their row (the default
    # mode reflows some rows and detaches the values from their label)
    try:
        text = "\n".join(pg.extract_text(extraction_mode="layout") or ""
                         for pg in PdfReader(path).pages)
    except Exception:
        return {}
    params = {}
    for line in text.splitlines():
        for pattern, out_key, factor in BRABANT_ROWS:
            if out_key in params or not re.search(pattern, line):
                continue
            nums = [num(t) for t in re.findall(r"\d+(?:,\d+)?", line)]
            nums = [v for v in nums if v is not None]
            if len(nums) >= 3:
                params[out_key] = round(nums[-3] * factor, 4)
            break
    return params


def merge_company_pdfs(company_prefix: str, pdf_urls: dict, parser) -> tuple:
    """Merge per-station PDF params into RIVM stations (matched by name
    containment after normalization)."""
    rivm_idx = {}
    for name, st in stations.items():
        if name.lower().startswith(company_prefix.lower()):
            rivm_idx[norm_name(name.split("_", 1)[-1])] = st
    matched = unmatched = 0
    for slug, url in pdf_urls.items():
        cache = os.path.join(PDF_DIR, f"{norm_name(slug)}.pdf")
        if not os.path.exists(cache) or os.path.getsize(cache) < 10_000:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    raw = r.read()
                with open(cache, "wb") as f:
                    f.write(raw)
                time.sleep(0.1)
            except Exception as e:
                print(f"  PDF KO {slug}: {e}")
                continue
        params = parser(cache)
        if "Ca_Hardness_dH" not in params:
            continue
        n_slug = norm_name(slug)
        st = rivm_idx.get(n_slug)
        if st is None:  # containment fallback: "bergenopzoom" in "bergenopzoommondaf"
            cands = [s for k, s in rivm_idx.items() if n_slug in k or k in n_slug]
            st = cands[0] if cands else None
        if st is None:
            unmatched += 1
            continue
        st["params"].update(params)
        matched += 1
    print(f"{company_prefix} PDFs merged: {matched} (no RIVM match: {unmatched})")


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


# --- Vitens ---
page = _fetch(VITENS_PAGE)
vitens_urls = {}
for m in re.finditer(r'href="(https://[^"]*?/wz_?[mn]pb-([a-z0-9-]+)\.pdf[^"]*)"', page):
    vitens_urls[m.group(2)] = m.group(1).replace("&amp;", "&")
print(f"Vitens station PDFs found: {len(vitens_urls)}")
merge_company_pdfs("Vitens", vitens_urls, parse_vitens_pdf)

# --- Brabant Water ---
page = _fetch(BRABANT_PAGE)
brabant_urls = {}
for m in re.finditer(r'href="(/sites/brabantwater\.nl/[^"]*?/([^"/]+?)%20Drinkwaterkwaliteit[^"]*\.pdf)"', page):
    slug = urllib.parse.unquote(m.group(2))
    brabant_urls[slug] = "https://www.brabantwater.nl" + m.group(1)
print(f"Brabant Water station PDFs found: {len(brabant_urls)}")
merge_company_pdfs("Brabant Water", brabant_urls, parse_brabant_pdf)

# --- 3. GeoNames NL cities ---
nl_cities = []
with open(GEONAMES, "r", encoding="utf-8") as f:
    for line in f:
        t = line.rstrip("\n").split("\t")
        if t[8] != "NL":
            continue
        if int(t[14] or 0) < MIN_POPULATION:
            continue
        nl_cities.append({"name": t[1], "lat": float(t[4]), "lng": float(t[5])})

# --- 4. Assign: mean of stations within ASSIGN_KM; hardness required ---
entries = []
st_list = list(stations.values())
for city in nl_cities:
    nearby = [s for s in st_list
              if haversine_km(city["lat"], city["lng"], s["lat"], s["lng"]) <= ASSIGN_KM]
    agg = {}
    for s in nearby:
        for k, v in s["params"].items():
            agg.setdefault(k, []).append(v)
    if "Ca_Hardness_dH" not in agg:
        continue  # SCA score would be null without the hardness chart
    parameters = {k: round(sum(v) / len(v), 4) for k, v in agg.items()}
    if len(parameters) < 3:
        continue
    entries.append({"Region": f"{city['name']} (Netherlands)", "Parameters": parameters})

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=1, ensure_ascii=False)
print(f"Wrote {OUT_JSON}: {len(entries)} cities (pop >= {MIN_POPULATION}, "
      f"hardness available)")
