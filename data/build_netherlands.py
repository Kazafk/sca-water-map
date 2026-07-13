"""
Build data/world/netherlands_rivm_water_quality.json from the RIVM INSPIRE
WFS 'drinkwaterkwaliteit' layer: yearly average concentrations measured at
each drinking-water pumping station as treated water leaves the plant
(2013-present, ~170 stations, all 10 Dutch water companies).

The layer has NO hardness/calcium/alkalinity (SCA score will be capped by
the front-end's missing-Ca rule); it provides pH, conductivity (mS/m),
sodium and chloride. Amsterdam/Rotterdam keep their richer 6-parameter
entries from the original tap-water-db file (build_world.py keeps the entry
with the most valid parameters when a city appears in several files).

Mapping stations -> cities: latest year per station, station RD coordinates
converted to WGS84, then every GeoNames NL city (pop >= 10 000) takes the
mean of the stations within ASSIGN_KM of it (nearest-station fallback works
poorly: Dutch supply areas are regional, several stations can serve a city).

Output: tap-water-db format [{Region: "Ville (Netherlands)", Parameters}].
The WFS response is cached in data/rivm/ (gitignored). Idempotent.
"""
import json
import math
import os
import urllib.request

_HERE      = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR  = os.path.join(_HERE, "rivm")
CACHE_FILE = os.path.join(CACHE_DIR, "drinkwaterkwaliteit.json")
GEONAMES   = os.path.join(_HERE, "geonames", "cities500.txt")
OUT_JSON   = os.path.join(_HERE, "world", "netherlands_rivm_water_quality.json")

WFS_URL = ("https://data.rivm.nl/geo/inspire/wfs?service=WFS&version=2.0.0"
           "&request=GetFeature&typeNames=inspire:drinkwaterkwaliteit"
           "&count=5000&outputFormat=application/json")

MIN_POPULATION = 10_000
ASSIGN_KM      = 20.0

os.makedirs(CACHE_DIR, exist_ok=True)


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
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# --- Fetch WFS (cached) ---
if not os.path.exists(CACHE_FILE) or os.path.getsize(CACHE_FILE) < 500_000:
    print("Downloading RIVM drinkwaterkwaliteit WFS layer...")
    urllib.request.urlretrieve(WFS_URL, CACHE_FILE)
with open(CACHE_FILE, "r", encoding="utf-8") as f:
    wfs = json.load(f)
print(f"WFS features: {len(wfs['features'])}")

# --- Latest year per station ---
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
        # mS/m -> uS/cm
        "TDS_Conductivity_uS_cm": (num(p.get("conductivity_ms_m")) or 0) * 10 or None,
        "Sodium_Na_mg_l":         num(p.get("sodium_mg_l")),
        "Chlorides_Cl_mg_l":      num(p.get("chloride_mg_l")),
    }
    params = {k: v for k, v in params.items() if v is not None}
    if len(params) < 3:
        continue
    lat, lng = rd_to_wgs84(x, y)
    stations[name] = {"year": year, "lat": lat, "lng": lng, "params": params}

print(f"Stations (latest year, >=3 params): {len(stations)}")

# --- GeoNames NL cities ---
nl_cities = []
with open(GEONAMES, "r", encoding="utf-8") as f:
    for line in f:
        t = line.rstrip("\n").split("\t")
        if t[8] != "NL":
            continue
        pop = int(t[14] or 0)
        if pop < MIN_POPULATION:
            continue
        nl_cities.append({"name": t[1], "lat": float(t[4]), "lng": float(t[5])})
print(f"GeoNames NL cities (pop >= {MIN_POPULATION}): {len(nl_cities)}")

# --- Assign: mean of stations within ASSIGN_KM of each city ---
entries = []
st_list = list(stations.values())
for city in nl_cities:
    nearby = [s for s in st_list
              if haversine_km(city["lat"], city["lng"], s["lat"], s["lng"]) <= ASSIGN_KM]
    if not nearby:
        continue
    agg = {}
    for s in nearby:
        for k, v in s["params"].items():
            agg.setdefault(k, []).append(v)
    parameters = {k: round(sum(v) / len(v), 4) for k, v in agg.items() if len(v)}
    if len(parameters) < 3:
        continue
    entries.append({"Region": f"{city['name']} (Netherlands)", "Parameters": parameters})

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=1, ensure_ascii=False)
print(f"Wrote {OUT_JSON}: {len(entries)} cities")
