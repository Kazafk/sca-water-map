"""
Build public/us-places.json: municipal boundary polygons (US Census Places)
for the US cities present in public/world-cities.json.

Source: Census cartographic boundary file cb_2023_us_place_500k (1:500k
simplified, all ~32k incorporated places + CDPs nationwide, single file).

Matching is spatial: a place polygon is kept iff at least one of our scored
US city points falls inside it (point-in-polygon, even-odd over all rings).
Name matching is only used to pick the best city when several points fall
in the same polygon.

Output feature properties: { city_id, name, st } — the front-end joins
city_id against world-cities.json for scores/params, so the metric selector
keeps working without rebuilding this file.

Idempotent; the raw Census download is cached in data/census/ (gitignored).
"""
import io
import json
import os
import re
import urllib.request
import zipfile

import shapefile  # pyshp
import unidecode

_HERE       = os.path.dirname(os.path.abspath(__file__))
CENSUS_DIR  = os.path.join(_HERE, "census")
CENSUS_ZIP  = os.path.join(CENSUS_DIR, "cb_2023_us_place_500k.zip")
CENSUS_URL  = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_place_500k.zip"
CITIES_JSON = os.path.join(_HERE, "..", "public", "world-cities.json")
OUT_JSON    = os.path.join(_HERE, "..", "public", "us-places.json")

COORD_DECIMALS = 4  # ~11 m precision, big size win

os.makedirs(CENSUS_DIR, exist_ok=True)

# --- Download (cached) ---
if not os.path.exists(CENSUS_ZIP) or os.path.getsize(CENSUS_ZIP) < 22_000_000:
    print("Downloading cb_2023_us_place_500k.zip (23 MB)...")
    urllib.request.urlretrieve(CENSUS_URL, CENSUS_ZIP)
print("Census places archive ready.")

# --- Load our US cities ---
with open(CITIES_JSON, "r", encoding="utf-8") as f:
    world_cities = json.load(f)
us_cities = [c for c in world_cities if c.get("country") == "US" and c.get("score") is not None]
print(f"US cities with score: {len(us_cities)}")


def normalize_name(name: str) -> str:
    name = unidecode.unidecode(name).lower()
    return re.sub(r"[^a-z0-9]", "", name)


def point_in_rings(lng: float, lat: float, rings) -> bool:
    """Even-odd rule across all rings (handles holes and multipolygons)."""
    inside = False
    for ring in rings:
        for i in range(len(ring)):
            x1, y1 = ring[i - 1]
            x2, y2 = ring[i]
            if (y1 > lat) != (y2 > lat):
                if lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                    inside = not inside
    return inside


def round_coords(obj):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], float):
            return [round(v, COORD_DECIMALS) for v in obj]
        return [round_coords(v) for v in obj]
    return obj


# --- Read shapefile from the zip ---
with zipfile.ZipFile(CENSUS_ZIP) as z:
    names = z.namelist()
    base = next(n[:-4] for n in names if n.endswith(".shp"))
    sf = shapefile.Reader(
        shp=io.BytesIO(z.read(base + ".shp")),
        dbf=io.BytesIO(z.read(base + ".dbf")),
        shx=io.BytesIO(z.read(base + ".shx")),
    )

field_names = [f[0] for f in sf.fields[1:]]
i_name  = field_names.index("NAME")
i_st    = field_names.index("STUSPS") if "STUSPS" in field_names else None
print(f"Shapefile: {len(sf)} places, fields: {field_names}")

features = []
matched_city_ids = set()

for shape_rec in sf.iterShapeRecords():
    shape, rec = shape_rec.shape, shape_rec.record
    minLng, minLat, maxLng, maxLat = shape.bbox

    # bbox pre-filter
    candidates = [
        c for c in us_cities
        if minLng <= c["lng"] <= maxLng and minLat <= c["lat"] <= maxLat
    ]
    if not candidates:
        continue

    # exact PIP on all rings
    parts = list(shape.parts) + [len(shape.points)]
    rings = [shape.points[parts[i]:parts[i + 1]] for i in range(len(parts) - 1)]
    inside = [c for c in candidates if point_in_rings(c["lng"], c["lat"], rings)]
    if not inside:
        continue

    place_name = rec[i_name]
    # Pick the city: exact normalized name match wins, else most complete entry
    n_place = normalize_name(place_name)
    exact = [c for c in inside if normalize_name(c["name"]) == n_place]
    pool = exact if exact else inside
    city = max(pool, key=lambda c: sum(1 for v in c["params"].values() if v is not None))

    if city["id"] in matched_city_ids:
        continue  # city already has a polygon (keep the first/name-matched one)
    matched_city_ids.add(city["id"])

    geom = shape.__geo_interface__
    geom = {"type": geom["type"], "coordinates": round_coords(geom["coordinates"])}

    features.append({
        "type": "Feature",
        "geometry": geom,
        "properties": {
            "city_id": city["id"],
            "name": place_name,
            "st": rec[i_st] if i_st is not None else None,
        },
    })

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))

size_mb = os.path.getsize(OUT_JSON) / 1e6
print(f"\nDone. {len(features)} place polygons for {len(us_cities)} scored US cities "
      f"({len(us_cities) - len(matched_city_ids)} unmatched).")
print(f"Wrote {OUT_JSON} ({size_mb:.1f} MB)")
