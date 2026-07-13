"""
Build public/eu-places.json: municipal boundary polygons (Eurostat GISCO LAU,
Local Administrative Units 2021, 1:1M scale) for the European cities present
in public/world-cities.json.

Same pattern as build_us_places.py: spatial matching — a LAU polygon is kept
iff one of our scored city points falls inside it. France is excluded (the
map already renders french communes from a dedicated layer).

Attribution requirement (GISCO open data licence):
  © EuroGeographics for the administrative boundaries

Output feature properties: { city_id, name, c } — the front-end joins
city_id against world-cities.json for scores/params.

The raw GISCO download (125 MB) is cached in data/gisco/ (gitignored).
"""
import json
import os
import re
import urllib.request

import unidecode

_HERE       = os.path.dirname(os.path.abspath(__file__))
GISCO_DIR   = os.path.join(_HERE, "gisco")
GISCO_FILE  = os.path.join(GISCO_DIR, "LAU_RG_01M_2021_4326.geojson")
GISCO_URL   = "https://gisco-services.ec.europa.eu/distribution/v2/lau/geojson/LAU_RG_01M_2021_4326.geojson"
CITIES_JSON = os.path.join(_HERE, "..", "public", "world-cities.json")
OUT_JSON    = os.path.join(_HERE, "..", "public", "eu-places.json")

COORD_DECIMALS = 4

# GISCO uses Eurostat country codes; map to ISO2 where they differ
GISCO_TO_ISO2 = {"EL": "GR", "UK": "GB"}
# France excluded: the map already has a dedicated communes layer
EXCLUDED = {"FR"}

os.makedirs(GISCO_DIR, exist_ok=True)

if not os.path.exists(GISCO_FILE) or os.path.getsize(GISCO_FILE) < 120_000_000:
    print("Downloading GISCO LAU 2021 GeoJSON (125 MB)...")
    urllib.request.urlretrieve(GISCO_URL, GISCO_FILE)
print("GISCO LAU file ready.")

with open(CITIES_JSON, "r", encoding="utf-8") as f:
    world_cities = json.load(f)


def normalize_name(name: str) -> str:
    name = unidecode.unidecode(name).lower()
    return re.sub(r"[^a-z0-9]", "", name)


def point_in_coords(lng, lat, coordinates, geom_type):
    """Even-odd PIP over all rings of a Polygon or MultiPolygon."""
    rings = []
    if geom_type == "Polygon":
        rings = coordinates
    elif geom_type == "MultiPolygon":
        for poly in coordinates:
            rings.extend(poly)
    inside = False
    for ring in rings:
        for i in range(len(ring)):
            x1, y1 = ring[i - 1][0], ring[i - 1][1]
            x2, y2 = ring[i][0], ring[i][1]
            if (y1 > lat) != (y2 > lat):
                if lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                    inside = not inside
    return inside


def coords_bbox(coordinates, geom_type):
    min_lng = min_lat = float("inf")
    max_lng = max_lat = float("-inf")
    polys = coordinates if geom_type == "MultiPolygon" else [coordinates]
    for poly in polys:
        for ring in poly:
            for pt in ring:
                if pt[0] < min_lng: min_lng = pt[0]
                if pt[0] > max_lng: max_lng = pt[0]
                if pt[1] < min_lat: min_lat = pt[1]
                if pt[1] > max_lat: max_lat = pt[1]
    return min_lng, min_lat, max_lng, max_lat


def round_coords(obj):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], float):
            return [round(v, COORD_DECIMALS) for v in obj]
        return [round_coords(v) for v in obj]
    return obj


print("Loading LAU GeoJSON (125 MB)...")
with open(GISCO_FILE, "r", encoding="utf-8") as f:
    lau = json.load(f)
print(f"LAU features: {len(lau['features'])}")

# Which countries does LAU actually cover?
lau_countries = set()
for feat in lau["features"]:
    cc = feat["properties"].get("CNTR_CODE")
    if cc:
        lau_countries.add(GISCO_TO_ISO2.get(cc, cc))

# Our scored, non-US, non-FR cities grouped by ISO2
cities_by_country = {}
for c in world_cities:
    iso2 = c.get("country")
    if iso2 in EXCLUDED or iso2 == "US" or c.get("score") is None:
        continue
    cities_by_country.setdefault(iso2, []).append(c)

covered   = {k: len(v) for k, v in cities_by_country.items() if k in lau_countries}
uncovered = {k: len(v) for k, v in cities_by_country.items() if k not in lau_countries}
print(f"Countries covered by LAU: {sorted(covered)}")
print(f"Cities in covered countries: {sum(covered.values())}")
print(f"NOT covered by LAU (need another source later): "
      f"{ {k: v for k, v in sorted(uncovered.items(), key=lambda x: -x[1])} }")

features = []
matched_city_ids = set()

for feat in lau["features"]:
    props = feat["properties"]
    cc = props.get("CNTR_CODE")
    iso2 = GISCO_TO_ISO2.get(cc, cc)
    if iso2 in EXCLUDED:
        continue
    candidates = cities_by_country.get(iso2)
    if not candidates:
        continue

    geom = feat["geometry"]
    if geom is None:
        continue
    min_lng, min_lat, max_lng, max_lat = coords_bbox(geom["coordinates"], geom["type"])
    in_bbox = [
        c for c in candidates
        if min_lng <= c["lng"] <= max_lng and min_lat <= c["lat"] <= max_lat
    ]
    if not in_bbox:
        continue
    inside = [
        c for c in in_bbox
        if point_in_coords(c["lng"], c["lat"], geom["coordinates"], geom["type"])
    ]
    if not inside:
        continue

    lau_name = props.get("LAU_NAME") or props.get("LAU_LABEL") or ""
    n_place = normalize_name(lau_name)
    exact = [c for c in inside if normalize_name(c["name"]) == n_place]
    pool = exact if exact else inside
    city = max(pool, key=lambda c: sum(1 for v in c["params"].values() if v is not None))

    if city["id"] in matched_city_ids:
        continue
    matched_city_ids.add(city["id"])

    features.append({
        "type": "Feature",
        "geometry": {"type": geom["type"], "coordinates": round_coords(geom["coordinates"])},
        "properties": {"city_id": city["id"], "name": lau_name, "c": iso2},
    })

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f,
              separators=(",", ":"), ensure_ascii=False)

total_eu = sum(covered.values())
size_mb = os.path.getsize(OUT_JSON) / 1e6
by_country = {}
for feat in features:
    by_country[feat["properties"]["c"]] = by_country.get(feat["properties"]["c"], 0) + 1
print(f"\nDone. {len(features)} LAU polygons matched "
      f"({total_eu - len(matched_city_ids)} covered-country cities unmatched).")
print(f"Per country: { {k: v for k, v in sorted(by_country.items(), key=lambda x: -x[1])} }")
print(f"Wrote {OUT_JSON} ({size_mb:.1f} MB)")
