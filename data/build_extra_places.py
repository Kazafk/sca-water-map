"""
Build public/extra-places.json: administrative boundary polygons (geoBoundaries,
gbOpen release, simplified geometries) for scored cities in countries covered
by neither GISCO LAU (Europe) nor a dedicated layer (US, FR): Eastern Europe
(UA, MD, BA, ME, XK, BY, AD, SM), the UK (excluded from LAU 2021) and the rest
of the world (CN, RU, CA, BR, TW, MX, JP, AU...).

Same pattern as build_eu_places.py: spatial matching — a polygon is kept iff
one of our scored city points falls inside it. The front-end merges this file
into the 'eu-places' source, so features share the same properties schema:
{ city_id, name, c }.

Attribution requirement (geoBoundaries licence): geoBoundaries (CC BY 4.0).

ADM level per country = finest municipality-like level available in gbOpen.
Raw downloads are cached in data/geoboundaries/ (gitignored).
"""
import json
import os
import urllib.request

_HERE       = os.path.dirname(os.path.abspath(__file__))
GB_DIR      = os.path.join(_HERE, "geoboundaries")
CITIES_JSON = os.path.join(_HERE, "..", "public", "world-cities.json")
OUT_JSON    = os.path.join(_HERE, "..", "public", "extra-places.json")

COORD_DECIMALS = 4

# iso2 -> (geoBoundaries iso3, ADM level)
# Level = finest municipality-like level with <= ~6000 units (bigger files
# bring no benefit: only polygons containing a scored city are kept).
COUNTRIES = {
    # Europe outside GISCO LAU coverage
    "UA": ("UKR", "ADM3"),  # hromadas/settlement councils (10 375)
    "MD": ("MDA", "ADM1"),  # raions (37)
    "BA": ("BIH", "ADM3"),  # municipalities (142)
    "ME": ("MNE", "ADM1"),  # municipalities (23)
    "XK": ("XKX", "ADM2"),  # municipalities (38)
    "BY": ("BLR", "ADM2"),  # raions (118)
    "AD": ("AND", "ADM1"),  # parishes (7)
    "SM": ("SMR", "ADM1"),  # castelli (9)
    "GB": ("GBR", "ADM3"),  # local authorities (216)
    # Rest of the world (scored cities without any polygon layer)
    "CN": ("CHN", "ADM3"),  # counties (2 867)
    "RU": ("RUS", "ADM2"),  # districts (2 328)
    "CA": ("CAN", "ADM3"),  # census subdivisions (5 162)
    "BR": ("BRA", "ADM2"),  # municipios (5 570)
    "TW": ("TWN", "ADM2"),  # townships/districts (369)
    "MX": ("MEX", "ADM2"),  # municipios (2 457)
    "AR": ("ARG", "ADM2"),  # departamentos (526)
    "AU": ("AUS", "ADM2"),  # LGAs (547)
    "CL": ("CHL", "ADM3"),  # comunas (345)
    "VE": ("VEN", "ADM2"),  # municipios (335)
    "PE": ("PER", "ADM2"),  # provincias (196)
    "ET": ("ETH", "ADM3"),  # woredas (690)
    "CD": ("COD", "ADM3"),  # territoires (188)
    "CO": ("COL", "ADM2"),  # municipios (1 122)
    "EC": ("ECU", "ADM2"),  # cantones (224)
    "UY": ("URY", "ADM2"),  # municipios (124)
    "KE": ("KEN", "ADM3"),  # wards (1 452)
    "EG": ("EGY", "ADM2"),  # markazes (365)
    "JP": ("JPN", "ADM2"),  # municipalities (1 745)
    "KR": ("KOR", "ADM2"),  # si/gun/gu (229)
    "TR": ("TUR", "ADM1"),  # provinces = perimetres buyuksehir (81)
    "CI": ("CIV", "ADM3"),  # departements (510)
    "BO": ("BOL", "ADM3"),  # municipios (339)
    "ZA": ("ZAF", "ADM3"),  # local municipalities (213)
    "DZ": ("DZA", "ADM3"),  # communes (1 540)
    "GH": ("GHA", "ADM2"),  # districts (260)
    "GT": ("GTM", "ADM2"),  # municipios (342)
    "NZ": ("NZL", "ADM3"),  # wards (245)
    "PG": ("PNG", "ADM3"),  # districts (326)
    "HN": ("HND", "ADM2"),  # municipios (299)
    "CR": ("CRI", "ADM3"),  # distritos (472)
    "PA": ("PAN", "ADM3"),  # corregimientos (633)
    "SV": ("SLV", "ADM2"),  # municipios (272)
    "FJ": ("FJI", "ADM3"),  # tikinas (86)
    "BZ": ("BLZ", "ADM2"),  # constituencies (31)
    "NG": ("NGA", "ADM2"),  # LGAs (774)
}

os.makedirs(GB_DIR, exist_ok=True)


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


def fetch_geoboundaries(iso3, adm):
    """Download (cached) the simplified GeoJSON for a country/level."""
    cache = os.path.join(GB_DIR, f"{iso3}_{adm}.geojson")
    if os.path.exists(cache) and os.path.getsize(cache) > 10_000:
        with open(cache, "r", encoding="utf-8") as f:
            return json.load(f)
    api = f"https://www.geoboundaries.org/api/current/gbOpen/{iso3}/{adm}/"
    with urllib.request.urlopen(api, timeout=60) as r:
        meta = json.load(r)
    url = meta["simplifiedGeometryGeoJSON"]
    print(f"  downloading {iso3} {adm} ...")
    urllib.request.urlretrieve(url, cache)
    with open(cache, "r", encoding="utf-8") as f:
        return json.load(f)


with open(CITIES_JSON, "r", encoding="utf-8") as f:
    world_cities = json.load(f)

cities_by_country = {}
for c in world_cities:
    iso2 = c.get("country")
    if iso2 in COUNTRIES and c.get("score") is not None:
        cities_by_country.setdefault(iso2, []).append(c)

features = []
matched_city_ids = set()

for iso2, (iso3, adm) in COUNTRIES.items():
    candidates = cities_by_country.get(iso2, [])
    if not candidates:
        print(f"{iso2}: no scored cities, skipped")
        continue
    print(f"{iso2}: {len(candidates)} scored cities, matching against {iso3} {adm}")
    geo = fetch_geoboundaries(iso3, adm)

    n_matched = 0
    for feat in geo["features"]:
        geom = feat.get("geometry")
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
        inside = [c for c in inside if c["id"] not in matched_city_ids]
        if not inside:
            continue

        # several cities in one polygon: keep the most complete entry
        city = max(inside, key=lambda c: sum(1 for v in c["params"].values() if v is not None))
        matched_city_ids.add(city["id"])
        n_matched += 1

        features.append({
            "type": "Feature",
            "geometry": {"type": geom["type"], "coordinates": round_coords(geom["coordinates"])},
            "properties": {
                "city_id": city["id"],
                "name": feat["properties"].get("shapeName") or city["name"],
                "c": iso2,
            },
        })
    print(f"  -> {n_matched} polygons ({len(candidates) - n_matched} cities unmatched)")

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f,
              separators=(",", ":"), ensure_ascii=False)

size_mb = os.path.getsize(OUT_JSON) / 1e6
by_country = {}
for feat in features:
    by_country[feat["properties"]["c"]] = by_country.get(feat["properties"]["c"], 0) + 1
print(f"\nDone. {len(features)} polygons total.")
print(f"Per country: { {k: v for k, v in sorted(by_country.items(), key=lambda x: -x[1])} }")
print(f"Wrote {OUT_JSON} ({size_mb:.1f} MB)")
