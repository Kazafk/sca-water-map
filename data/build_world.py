import json
import os
import re
import urllib.request
import zipfile
import math
import csv
import unidecode

# --- Configuration ---
_HERE                = os.path.dirname(os.path.abspath(__file__))
TAP_WATER_DB_DIR     = os.path.join(_HERE, "world")
DATA_DIR             = _HERE
GEONAMES_DIR         = os.path.join(_HERE, "geonames")
GEONAMES_ZIP         = os.path.join(GEONAMES_DIR, "cities500.zip")
GEONAMES_TXT         = os.path.join(GEONAMES_DIR, "cities500.txt")
PUBLIC_DIR           = os.path.join(_HERE, "..", "public")
WORLD_CITIES_JSON    = os.path.join(PUBLIC_DIR, "world-cities.json")
WORLD_COUNTRIES_JSON = os.path.join(PUBLIC_DIR, "world-countries.json")
MISSES_CSV           = os.path.join(DATA_DIR, "geocoding_misses.csv")

# Ensure directories exist
os.makedirs(GEONAMES_DIR, exist_ok=True)
os.makedirs(PUBLIC_DIR, exist_ok=True)

# --- Download GeoNames if needed ---
if not os.path.exists(GEONAMES_TXT):
    print("Downloading GeoNames cities500.zip...")
    urllib.request.urlretrieve("https://download.geonames.org/export/dump/cities500.zip", GEONAMES_ZIP)
    print("Extracting...")
    with zipfile.ZipFile(GEONAMES_ZIP, 'r') as zip_ref:
        zip_ref.extractall(GEONAMES_DIR)
    print("GeoNames ready.")

# Country name to ISO2 mapping (basic, will expand as needed)
import pycountry
def get_iso2_and_name(country_str):
    country_str = country_str.strip()
    try:
        if len(country_str) == 2:
            c = pycountry.countries.get(alpha_2=country_str.upper())
            if c: return c.alpha_2, c.name
        c = pycountry.countries.search_fuzzy(country_str)[0]
        return c.alpha_2, c.name
    except:
        # Fallbacks
        fallbacks = {
            "UK": ("GB", "United Kingdom"),
            "USA": ("US", "United States"),
            "Russia": ("RU", "Russian Federation"),
            "South Korea": ("KR", "South Korea"),
            "Ivory Coast": ("CI", "Côte d'Ivoire"),
            "DR Congo": ("CD", "Congo, The Democratic Republic of the")
        }
        if country_str in fallbacks:
            return fallbacks[country_str]
        return None, country_str

# --- Load GeoNames Data ---
print("Loading GeoNames data into memory...")
geonames_db = {} # (normalized_name, iso2) -> info
# Also build an index just by normalized_name for fallback
geonames_by_name = {}

def normalize_name(name):
    name = unidecode.unidecode(name).lower()
    name = re.sub(r'[^a-z0-9]', '', name)
    return name

with open(GEONAMES_TXT, 'r', encoding='utf-8') as f:
    for line in f:
        parts = line.strip('\n').split('\t')
        if len(parts) < 15: continue
        name = parts[1]
        asciiname = parts[2]
        altnames = parts[3].split(',')
        lat = float(parts[4])
        lng = float(parts[5])
        iso2 = parts[8].upper()
        pop = int(parts[14]) if parts[14].isdigit() else 0

        names_to_add = set([normalize_name(name), normalize_name(asciiname)])
        for alt in altnames:
            if alt: names_to_add.add(normalize_name(alt))
        
        info = {'lat': lat, 'lng': lng, 'pop': pop, 'name': name}
        
        for n in names_to_add:
            key = (n, iso2)
            if key not in geonames_db or geonames_db[key]['pop'] < pop:
                geonames_db[key] = info
            if n not in geonames_by_name or geonames_by_name[n]['pop'] < pop:
                geonames_by_name[n] = info

# --- Helper functions ---
def parse_value(val_str):
    if not val_str or val_str == "null": return None
    if isinstance(val_str, (int, float)): return float(val_str)
    val_str = str(val_str).strip()
    if '-' in val_str:
        parts = val_str.split('-')
        try:
            return (float(parts[0]) + float(parts[1])) / 2.0
        except:
            return None
    try:
        return float(re.sub(r'[^\d.]', '', val_str))
    except:
        return None

def score_range(val, lo, hi, max_lo, max_hi):
    if val is None: return None
    if lo <= val <= hi: return 1.0
    if val < lo:
        span = lo - max_lo
        return max(0.0, 1.0 - (lo - val) / span) if span > 0 else 0.0
    span = max_hi - hi
    return max(0.0, 1.0 - (val - hi) / span) if span > 0 else 0.0

def score_chart(ca, alk):
    if ca is not None and alk is not None:
        dCa = abs(ca - 68) / 85.0
        dAlk = abs(alk - 55) / 75.0
        return max(0.0, 1.0 - math.sqrt(dCa**2 + dAlk**2) / math.sqrt(2))
    if ca is not None:
        return max(0.0, 1.0 - abs(ca - 68) / 85.0)
    if alk is not None:
        return max(0.0, 1.0 - abs(alk - 55) / 75.0)
    return None

def compute_sca_score(params):
    ca = params.get('ca_hardness')
    alk = params.get('alkalinity')
    sc = score_chart(ca, alk)
    if sc is None: return None

    secondaries = [
        (score_range(params.get('ph'), 6.5, 7.5, 0, 14), 0.08),
        (score_range(params.get('tds'), 75, 250, 0, 500), 0.06),
        (score_range(params.get('na'), 0, 30, 0, 100), 0.03),
        (score_range(params.get('cl'), 0, 75, 0, 200), 0.02)
    ]
    
    avail = [x for x in secondaries if x[0] is not None]
    total_w = sum(x[1] for x in avail)
    sec_score = sum(x[0]*x[1] for x in avail) / total_w if total_w > 0 else 0.0
    
    final_score = 0.80 * sc + 0.20 * sec_score
    
    # Capped score logic
    if ca is None: final_score = min(final_score, 0.85)
    if params.get('na') is None: final_score = min(final_score, 0.95)
    
    return round(final_score, 4)

# --- Process Data ---
print("Processing tap-water-db...")
cities_data = {}
misses = []

for filename in os.listdir(TAP_WATER_DB_DIR):
    if not filename.endswith('.json') or filename == 'france_water_quality.json' or filename == 'country_cities_mapping.json':
        continue
    
    filepath = os.path.join(TAP_WATER_DB_DIR, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except:
            continue
    
    file_country_raw = filename.replace('_water_quality.json', '').replace('_', ' ').title()
    
    for entry in data:
        region = entry.get('Region', '')
        if not region: continue
        
        country_str = file_country_raw
        city_str = region
        
        m = re.match(r'^(.*?)\s*\((.*?)\)$', region)
        if m:
            city_str = m.group(1).strip()
            country_str = m.group(2).strip()
            
        iso2, country_name = get_iso2_and_name(country_str)
        if not iso2: iso2 = country_str[:2].upper()
        
        n_city = normalize_name(city_str)
        geo_info = geonames_db.get((n_city, iso2))
        if not geo_info:
            geo_info = geonames_by_name.get(n_city)
            
        if not geo_info:
            misses.append({'city': city_str, 'country': country_str, 'file': filename})
            continue
            
        p = entry.get('Parameters', {})
        
        ca_hardness_dh = parse_value(p.get('Ca_Hardness_dH'))
        ca_hardness = round(ca_hardness_dh * 17.848, 2) if ca_hardness_dh is not None else None
        
        alk_mmol = parse_value(p.get('Alkalinity_TAC_mmol_l'))
        alkalinity = round(alk_mmol * 50.0, 2) if alk_mmol is not None else None
        
        ph = parse_value(p.get('pH'))
        tds = parse_value(p.get('TDS_Conductivity_uS_cm'))
        na = parse_value(p.get('Sodium_Na_mg_l'))
        cl = parse_value(p.get('Chlorides_Cl_mg_l'))
        
        params = {
            'ca_hardness': ca_hardness,
            'alkalinity': alkalinity,
            'ph': ph,
            'tds': tds,
            'na': na,
            'cl': cl
        }
        
        score = compute_sca_score(params)
        
        valid_params = sum(1 for v in params.values() if v is not None)
        city_id = f"{normalize_name(geo_info['name'])}-{iso2}"
        
        if city_id not in cities_data or cities_data[city_id]['_valid_params'] < valid_params:
            cities_data[city_id] = {
                'id': city_id,
                'name': geo_info['name'],
                'country': iso2,
                'country_name': country_name,
                'lat': geo_info['lat'],
                'lng': geo_info['lng'],
                'score': score,
                'params': params,
                '_valid_params': valid_params
            }

# Remove internal keys
for v in cities_data.values():
    del v['_valid_params']

with open(MISSES_CSV, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['city', 'country', 'file'])
    writer.writeheader()
    writer.writerows(misses)

# --- Aggregate Countries ---
countries_data = {}
for c in cities_data.values():
    iso = c['country']
    if iso not in countries_data:
        countries_data[iso] = {'iso2': iso, 'name': c['country_name'], 'scores': [], 'city_count': 0, 'scored_count': 0}
    countries_data[iso]['city_count'] += 1
    if c['score'] is not None:
        countries_data[iso]['scores'].append(c['score'])
        countries_data[iso]['scored_count'] += 1

countries_list = []
for iso, cd in countries_data.items():
    avg = sum(cd['scores']) / len(cd['scores']) if cd['scores'] else None
    countries_list.append({
        'iso2': iso,
        'name': cd['name'],
        'avg_score': round(avg, 4) if avg is not None else None,
        'city_count': cd['city_count'],
        'scored_count': cd['scored_count']
    })

# --- Write JSONs ---
with open(WORLD_CITIES_JSON, 'w', encoding='utf-8') as f:
    json.dump(list(cities_data.values()), f, separators=(',', ':'))

with open(WORLD_COUNTRIES_JSON, 'w', encoding='utf-8') as f:
    json.dump(countries_list, f, separators=(',', ':'))

print(f"Done. Wrote {len(cities_data)} cities and {len(countries_list)} countries.")
print(f"Geocoding misses: {len(misses)} (see {MISSES_CSV})")
