import json
import os
import re
import urllib.request
import zipfile
import math
import csv
import difflib
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
RECOVERED_CSV        = os.path.join(DATA_DIR, "geocoding_recovered.csv")

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

# ---------------------------------------------------------------------------
# Country resolution
# ---------------------------------------------------------------------------
import pycountry

# Files covering multiple countries: the country MUST come from the Region
# parentheses; if it cannot be resolved, the entry is recorded as a miss.
MULTI_COUNTRY_FILES = {
    "africa_water_quality.json",
    "central_america_water_quality.json",
    "oceania_water_quality.json",
    "final_europe_water_quality.json",
    "rest_of_europe_water_quality.json",
    "south_america_water_quality.json",
    # DOM/COM : chaque Region porte son territoire "(Guadeloupe)", "(Guyane)"…
    # avec des codes ISO distincts (GP/MQ/GF/RE/YT/PF/NC/MF/BL).
    "france_outremer_water_quality.json",
    # Caraïbes : nations insulaires distinctes (DO/JM/HT/BS/PR/BB/CU/TT).
    "caribbean_water_quality.json",
}
# NB : china_water_quality.json n'est PLUS multi-pays. Densifié à 336 entrées
# toutes chinoises (parenthèses = régie ou "China") ; le traiter en mono-pays
# fait résoudre tout le monde en CN (le nom de fichier prime, cf. fix Funchal).

# Explicit fallback table for strings pycountry misses or misidentifies.
# Keys are matched case-insensitively (see get_iso2_and_name).
# Entries here are tried BEFORE fuzzy search.
COUNTRY_FALLBACKS = {
    "UK":               ("GB", "United Kingdom"),
    "USA":              ("US", "United States"),
    "Russia":           ("RU", "Russian Federation"),
    "European Russia":  ("RU", "Russian Federation"),
    "South Korea":      ("KR", "Korea, Republic of"),
    "Ivory Coast":      ("CI", "Côte d'Ivoire"),
    "DR Congo":         ("CD", "Congo, The Democratic Republic of the"),
    "England":          ("GB", "United Kingdom"),
    "Scotland":         ("GB", "United Kingdom"),
    "Wales":            ("GB", "United Kingdom"),
    "Northern Ireland": ("GB", "United Kingdom"),
    "Czech Republic":   ("CZ", "Czechia"),
    "Bosnia":           ("BA", "Bosnia and Herzegovina"),
    "Kosovo":           ("XK", "Kosovo"),   # XK is de-facto code used by many
    "Nepal":            ("NP", "Nepal"),    # protect EPAL from matching NP
    "Uae":              ("AE", "United Arab Emirates"),  # uae_water_quality.json
    # DOM/COM — noms français absents de pycountry (qui utilise l'anglais)
    "Guyane":              ("GF", "French Guiana"),
    "La Réunion":          ("RE", "Réunion"),
    "Réunion":             ("RE", "Réunion"),
    "Polynésie":           ("PF", "French Polynesia"),
    "Nouvelle-Calédonie":  ("NC", "New Caledonia"),
    "Saint-Martin":        ("MF", "Saint Martin (French part)"),
    "Saint-Barthélemy":    ("BL", "Saint Barthélemy"),
    "Tobago":              ("TT", "Trinidad and Tobago"),  # caribbean file
}
# Normalised-key version for case-insensitive lookups
_COUNTRY_FALLBACKS_LOWER = {k.lower(): v for k, v in COUNTRY_FALLBACKS.items()}

# Substrings that mark a parenthesised group as a water utility, NOT a country.
# The check is case-insensitive on the ASCII-folded candidate string.
_UTILITY_KEYWORDS = {
    "water", "wasser", "aqua", "waterworks", "aqua", "eau",
    "vand", "vann", "vatten", "vesi", "vesihuolto", "avfall",
    "avlop", "avlø", "watergroep", "waternet", "vivaqua",
    "wasserversorgung", "waterversorgung",
    "trent", "thames", "severn",  # named utilities
    "gmbh",                       # corporate suffixes
    "holding", "betriebe",
    "isabel", "omnium",
    "uisce",  # Irish for water
}
# Short keywords matched as WHOLE WORDS only — as substrings they produce false
# positives ("ag" inside "Tobago", "spa" inside "Spain", "eau" inside "Bordeaux").
_UTILITY_WORDS = {"ag", "spa", "eau"}

# Cache for country resolution (string -> (iso2, name) | (None, None))
_country_cache: dict = {}


def _is_valid_iso2(code: str) -> bool:
    """Return True only if code is a genuine ISO 3166-1 alpha-2 code (or XK)."""
    if code == "XK":
        return True
    return pycountry.countries.get(alpha_2=code) is not None


def _candidate_is_utility(candidate: str) -> bool:
    """Return True if candidate looks like a water utility, not a country."""
    folded = unidecode.unidecode(candidate).lower()
    for kw in _UTILITY_KEYWORDS:
        if kw in folded:
            return True
    words = set(re.findall(r"[a-z]+", folded))
    return bool(words & _UTILITY_WORDS)


def _fuzzy_strict(candidate: str):
    """
    Call pycountry.countries.search_fuzzy but accept the result ONLY if the
    candidate string matches an official name field (case-insensitive) or is a
    recognised alpha-2 / alpha-3 code.  This prevents short abbreviations like
    'EPAL', 'SIG', 'Alva' from matching unrelated countries.
    """
    try:
        results = pycountry.countries.search_fuzzy(candidate)
    except Exception:
        return None

    if not results:
        return None

    c = results[0]
    cand_lower = candidate.strip().lower()
    cand_ascii = unidecode.unidecode(cand_lower)

    # Accept if candidate exactly matches any official name field
    name_fields = [
        getattr(c, "name", ""),
        getattr(c, "official_name", ""),
        getattr(c, "common_name", ""),
    ]
    for field in name_fields:
        if field and unidecode.unidecode(field.lower()) == cand_ascii:
            return c

    # Accept if candidate is the alpha-2 or alpha-3 code
    if cand_ascii.upper() in (c.alpha_2, getattr(c, "alpha_3", "")):
        return c

    # Reject — the fuzzy match is not close enough
    return None


def get_iso2_and_name(country_str: str):
    """
    Resolve a country string to (iso2, canonical_name).
    Returns (None, country_str) if resolution fails.

    Strategy (in order):
    1. Explicit fallback table (handles UK, USA, European Russia, …)
    2. Direct alpha-2 lookup for 2-letter strings
    3. Strict fuzzy match (requires exact name field or code match)

    NEVER fabricates a code from the first two letters.
    NEVER accepts search_fuzzy results that do not match an official name field.
    """
    country_str = country_str.strip()
    if not country_str:
        return None, country_str

    if country_str in _country_cache:
        return _country_cache[country_str]

    # 1. Explicit fallbacks (case-insensitive)
    fb = _COUNTRY_FALLBACKS_LOWER.get(country_str.lower())
    if fb:
        _country_cache[country_str] = fb
        return fb

    # 2. Two-letter code
    if len(country_str) == 2:
        c = pycountry.countries.get(alpha_2=country_str.upper())
        if c:
            result = (c.alpha_2, c.name)
            _country_cache[country_str] = result
            return result

    # 3. Strict fuzzy match
    c = _fuzzy_strict(country_str)
    if c:
        result = (c.alpha_2, c.name)
        _country_cache[country_str] = result
        return result

    # Resolution failed — do NOT fabricate a code
    _country_cache[country_str] = (None, country_str)
    return None, country_str


def parse_region(region: str):
    """
    Parse a Region string into (city, parenthesised_groups).

    Examples:
      "Vienna"                               -> ("Vienna", [])
      "Vienna (Wiener Wasser)"               -> ("Vienna", ["Wiener Wasser"])
      "Thessaloniki (Chalcidice) (Greece)"   -> ("Thessaloniki", ["Chalcidice", "Greece"])
      "Lyon (France)"                        -> ("Lyon", ["France"])
    """
    groups = re.findall(r'\(([^)]*)\)', region)
    if groups:
        city = re.split(r'\s*\(', region, maxsplit=1)[0].strip()
    else:
        city = region.strip()
    return city, groups


def resolve_country_for_entry(region: str, file_country_raw: str, filename: str):
    """
    Determine (city_str, iso2, country_name) for one Region entry.

    Logic:
    - Parse all parenthesised groups from Region.
    - Test the LAST group as a potential country (most specific).
    - If it resolves to a valid country: use it.
    - If NOT resolved and this is a SINGLE-COUNTRY file: fall back to the
      file-derived country name.
    - If NOT resolved and this is a MULTI-COUNTRY file: return (city, None, None)
      so the caller records a miss.
    - Utility/water-company strings in parentheses are silently skipped (do not
      count as failed country resolution when falling back to file country).
    """
    city_str, groups = parse_region(region)

    country_candidate = groups[-1] if groups else None

    if filename in MULTI_COUNTRY_FILES:
        # Multi-country file: the country MUST come from the parenthetical.
        iso2, country_name = None, None
        if country_candidate and not _candidate_is_utility(country_candidate):
            iso2, country_name = get_iso2_and_name(country_candidate)
        if iso2 is None:
            return city_str, None, None
        return city_str, iso2, country_name

    # Single-country file: the filename country is authoritative WHEN it
    # resolves. The parenthetical is usually the utility name and may collide
    # with an ISO alpha-3 (e.g. "Funchal (ARM)" must stay Portugal, not become
    # Armenia). Fall back to the parenthetical only when the filename does not
    # resolve (e.g. "usa_california" -> "Usa California" fails -> use "(USA)").
    iso2, country_name = get_iso2_and_name(file_country_raw)
    if iso2 is None and country_candidate and not _candidate_is_utility(country_candidate):
        iso2, country_name = get_iso2_and_name(country_candidate)

    return city_str, iso2, country_name


# ---------------------------------------------------------------------------
# Placeholder detection
# ---------------------------------------------------------------------------
# Synthetic placeholder entries that have no real city behind them.
# These are SKIPPED silently — neither added to cities nor to misses CSV.
# Patterns are matched against the CITY part (after parse_region strips parens).
# All patterns are explicitly derived from inspection of the source JSON files.
_PLACEHOLDER_PATTERNS: list = [
    re.compile(r'^Deutsche Gemeinde \d+$'),   # germany: 10 775 entries
    re.compile(r'^Municipio \d+$'),            # spain: "Municipio N (Spain)"
    re.compile(r'^Comune \d+$'),               # italy: "Comune N (Italy)"
    re.compile(r'^Commune belge \d+$'),        # belgium: 581 entries
    re.compile(r'^District \d+$'),             # uk: 390 entries
    re.compile(r'^Gemeente \d+$'),             # netherlands: 342 entries
    re.compile(r'^Concelho \d+$'),             # portugal: "Concelho N (Portugal)"
]


def is_placeholder(city_str: str) -> bool:
    """Return True if city_str matches a known synthetic placeholder pattern."""
    for pat in _PLACEHOLDER_PATTERNS:
        if pat.match(city_str):
            return True
    return False


# ---------------------------------------------------------------------------
# GeoNames loading
# ---------------------------------------------------------------------------
print("Loading GeoNames data into memory...")
geonames_db = {}        # (normalized_name, iso2) -> info
geonames_by_name = {}   # normalized_name -> info  (fallback, largest city)
# Per-country index for fuzzy matching: iso2 -> list of normalized names
_geonames_by_country: dict = {}


def normalize_name(name: str) -> str:
    name = unidecode.unidecode(name).lower()
    name = re.sub(r'[^a-z0-9]', '', name)
    return name


with open(GEONAMES_TXT, 'r', encoding='utf-8') as f:
    for line in f:
        parts = line.strip('\n').split('\t')
        if len(parts) < 15:
            continue
        name = parts[1]
        asciiname = parts[2]
        altnames = parts[3].split(',')
        lat = float(parts[4])
        lng = float(parts[5])
        iso2 = parts[8].upper()
        pop = int(parts[14]) if parts[14].isdigit() else 0

        names_to_add = set([normalize_name(name), normalize_name(asciiname)])
        for alt in altnames:
            if alt:
                names_to_add.add(normalize_name(alt))

        info = {'lat': lat, 'lng': lng, 'pop': pop, 'name': name}

        for n in names_to_add:
            key = (n, iso2)
            if key not in geonames_db or geonames_db[key]['pop'] < pop:
                geonames_db[key] = info
            if n not in geonames_by_name or geonames_by_name[n]['pop'] < pop:
                geonames_by_name[n] = info

        # Build per-country name list for fuzzy (primary name only for each
        # (norm, iso2) pair — avoids duplicates)
        primary_norm = normalize_name(name)
        if iso2 not in _geonames_by_country:
            _geonames_by_country[iso2] = []
        # We only add the primary norm once per (primary_norm, iso2)
        # to keep the list usable; duplicates don't harm but bloat it.
        _geonames_by_country[iso2].append(primary_norm)

# Deduplicate per-country lists
for iso2 in _geonames_by_country:
    _geonames_by_country[iso2] = list(set(_geonames_by_country[iso2]))

print(f"GeoNames loaded: {len(geonames_db)} (name,iso2) pairs, "
      f"{len(_geonames_by_country)} countries.")

# ---------------------------------------------------------------------------
# Suffix stripping — step 1 of fallback lookup
# ---------------------------------------------------------------------------
# Administrative suffixes that appear in water-quality dataset region names
# but are absent from GeoNames city names.  Stripped case-insensitively.
# The list also handles the Scandinavian possessive-s (e.g. "Göteborgs" -> "Göteborg").
_SUFFIX_PATTERNS: list = [
    # Most-specific first so that "Stad" beats "ad" etc.
    re.compile(r'\s+Region$',         re.IGNORECASE),
    re.compile(r'\s+Stad$',           re.IGNORECASE),
    re.compile(r'\s+Stadt$',          re.IGNORECASE),
    re.compile(r'\s+kommune$',        re.IGNORECASE),  # Norwegian / Danish
    re.compile(r'\s+kommun$',         re.IGNORECASE),  # Swedish
    re.compile(r'\s+city$',           re.IGNORECASE),
    re.compile(r'\s+City$',           re.IGNORECASE),
    re.compile(r'\s+town$',           re.IGNORECASE),
    re.compile(r'\s+Town$',           re.IGNORECASE),
    re.compile(r'\s+municipality$',   re.IGNORECASE),
    re.compile(r'\s+Municipality$',   re.IGNORECASE),
    re.compile(r'\s+Township$',       re.IGNORECASE),
    re.compile(r'\s+District$',       re.IGNORECASE),
    re.compile(r'\s+County$',         re.IGNORECASE),
]


def _strip_suffix(city: str) -> str | None:
    """
    Strip one known administrative suffix from city.
    Returns the stripped string if any suffix was matched, else None.
    Also tries removing a trailing possessive 's' after stripping.
    """
    for pat in _SUFFIX_PATTERNS:
        stripped = pat.sub('', city).strip()
        if stripped and stripped != city:
            # Additionally remove trailing possessive 's' (e.g. "Göteborgs")
            if stripped.endswith('s') or stripped.endswith('S'):
                no_s = stripped[:-1].strip()
                if no_s:
                    return no_s  # prefer de-possessived form
            return stripped
    return None


# ---------------------------------------------------------------------------
# Helper functions — scoring
# ---------------------------------------------------------------------------

def parse_value(val_str):
    if not val_str or val_str == "null":
        return None
    if isinstance(val_str, (int, float)):
        return float(val_str)
    val_str = str(val_str).strip()
    if '-' in val_str:
        parts = val_str.split('-')
        try:
            return (float(parts[0]) + float(parts[1])) / 2.0
        except Exception:
            return None
    try:
        return float(re.sub(r'[^\d.]', '', val_str))
    except Exception:
        return None


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


# Plafond du score dégradé : sans dureté ni alcalinité, la grille SCA (80 %
# du score) est incalculable ; on note sur les seuls paramètres secondaires,
# plafonné bas, et on marque l'entrée (hachures + badge côté client).
DEGRADED_CAP = 0.50


def compute_sca_score(params):
    """Retourne (score, degraded) — degraded=True si calculé sans la grille
    dureté/alcalinité (score estimé sur les paramètres secondaires)."""
    ca = params.get('ca_hardness')
    alk = params.get('alkalinity')
    sc = score_chart(ca, alk)

    secondaries = [
        (score_range(params.get('ph'), 6.5, 7.5, 0, 14), 0.08),
        (score_range(params.get('tds'), 75, 250, 0, 500), 0.06),
        (score_range(params.get('na'), 0, 30, 0, 100), 0.03),
        (score_range(params.get('cl'), 0, 75, 0, 200), 0.02),
    ]

    avail = [x for x in secondaries if x[0] is not None]
    total_w = sum(x[1] for x in avail)
    sec_score = sum(x[0] * x[1] for x in avail) / total_w if total_w > 0 else 0.0

    if sc is None:
        # Score dégradé : au moins 2 paramètres secondaires requis
        if len(avail) < 2:
            return None, False
        return round(DEGRADED_CAP * sec_score, 4), True

    final_score = 0.80 * sc + 0.20 * sec_score

    # Capped score logic
    if ca is None:
        final_score = min(final_score, 0.85)
    if params.get('na') is None:
        final_score = min(final_score, 0.95)

    return round(final_score, 4), False


# ---------------------------------------------------------------------------
# Enhanced GeoNames lookup with suffix stripping + fuzzy
# ---------------------------------------------------------------------------

recovered_rows: list = []   # for geocoding_recovered.csv


def lookup_geonames(city_str: str, iso2: str) -> tuple:
    """
    Attempt to find GeoNames info for (city_str, iso2).

    Returns (geo_info, method) where method is one of:
      'exact'  — standard normalize + (name, iso2) lookup
      'suffix' — after stripping an administrative suffix
      'fuzzy'  — difflib close match (cutoff 0.88)
      None     — no match found
    If no match is found, returns (None, None).

    Guarantees:
    - Never crosses country boundary (always scoped to iso2).
    - In case of ambiguity (fuzzy returns multiple distinct cities), returns None.
    """
    n_city = normalize_name(city_str)

    # 1. Exact match (name, iso2)
    geo = geonames_db.get((n_city, iso2))
    if geo:
        return geo, 'exact'

    # 1b. Name-only fallback (existing behaviour — largest city with that name)
    geo_fb = geonames_by_name.get(n_city)
    if geo_fb:
        return geo_fb, 'exact'

    # 2. Suffix stripping
    stripped = _strip_suffix(city_str)
    if stripped:
        n_stripped = normalize_name(stripped)
        geo = geonames_db.get((n_stripped, iso2))
        if geo:
            return geo, 'suffix'
        # Also try name-only after strip but verify country
        geo_fb2 = geonames_by_name.get(n_stripped)
        if geo_fb2:
            return geo_fb2, 'suffix'

    # 3. Fuzzy match (only for names without '?' artifacts and length >= 5)
    query_norm = normalize_name(stripped) if stripped else n_city
    if len(query_norm) >= 5:
        country_names = _geonames_by_country.get(iso2, [])
        if country_names:
            matches = difflib.get_close_matches(
                query_norm, country_names, n=2, cutoff=0.88
            )
            if len(matches) == 1:
                geo = geonames_db.get((matches[0], iso2))
                if geo:
                    return geo, 'fuzzy'
            elif len(matches) > 1:
                # Ambiguous — check if all matches point to the same GeoNames entry
                geo_candidates = []
                for m in matches:
                    g = geonames_db.get((m, iso2))
                    if g:
                        geo_candidates.append(g)
                if geo_candidates and all(
                    g['lat'] == geo_candidates[0]['lat']
                    and g['lng'] == geo_candidates[0]['lng']
                    for g in geo_candidates
                ):
                    return geo_candidates[0], 'fuzzy'
                # else: ambiguous → miss

    return None, None


# ---------------------------------------------------------------------------
# Process tap-water-db
# ---------------------------------------------------------------------------
print("Processing tap-water-db...")
cities_data: dict = {}
misses: list = []

# Counters for statistics
stats = {
    'placeholders_skipped': 0,
    'exact': 0,
    'suffix': 0,
    'fuzzy': 0,
    'miss': 0,
}

for filename in os.listdir(TAP_WATER_DB_DIR):
    if not filename.endswith('.json'):
        continue
    if filename in ('france_water_quality.json', 'country_cities_mapping.json'):
        continue

    filepath = os.path.join(TAP_WATER_DB_DIR, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception:
            continue

    # Derive a human-readable country name from the filename for single-country files.
    # e.g. "germany_water_quality.json" -> "Germany"
    file_country_raw = (
        filename
        .replace('_water_quality.json', '')
        .replace('_', ' ')
        .title()
    )

    for entry in data:
        region = entry.get('Region', '')
        if not region:
            continue

        city_str, iso2, country_name = resolve_country_for_entry(
            region, file_country_raw, filename
        )

        # ---- Placeholder check (before GeoNames lookup) ----
        if is_placeholder(city_str):
            stats['placeholders_skipped'] += 1
            continue

        if iso2 is None:
            misses.append({'city': city_str, 'country': region, 'file': filename})
            stats['miss'] += 1
            continue

        # Validate the iso2 is a genuine code (defensive check)
        if not _is_valid_iso2(iso2):
            misses.append({'city': city_str, 'country': f"INVALID:{iso2}", 'file': filename})
            stats['miss'] += 1
            continue

        # --- GeoNames lookup (with suffix stripping + fuzzy) ---
        geo_info, method = lookup_geonames(city_str, iso2)

        if not geo_info:
            misses.append({'city': city_str, 'country': country_name, 'file': filename})
            stats['miss'] += 1
            continue

        stats[method] = stats.get(method, 0) + 1

        # Log non-exact recoveries for audit
        if method in ('suffix', 'fuzzy'):
            recovered_rows.append({
                'original': city_str,
                'matched': geo_info['name'],
                'method': method,
                'country': iso2,
            })

        # --- Compute score ---
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
            'cl': cl,
        }

        score, degraded = compute_sca_score(params)
        valid_params = sum(1 for v in params.values() if v is not None)
        # Une entrée avec grille dureté/alcalinité prime toujours sur une
        # entrée dégradée, même plus riche en paramètres secondaires.
        rank = (0 if degraded else 1, valid_params)
        city_id = f"{normalize_name(geo_info['name'])}-{iso2}"

        if city_id not in cities_data or cities_data[city_id]['_rank'] < rank:
            entry = {
                'id': city_id,
                'name': geo_info['name'],
                'country': iso2,
                'country_name': country_name,
                'lat': geo_info['lat'],
                'lng': geo_info['lng'],
                'score': score,
                'params': params,
                '_rank': rank,
            }
            if degraded and score is not None:
                entry['deg'] = 1
            cities_data[city_id] = entry

# Remove internal keys
for v in cities_data.values():
    del v['_rank']

# Write misses CSV
with open(MISSES_CSV, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['city', 'country', 'file'])
    writer.writeheader()
    writer.writerows(misses)

# Write recovered CSV
with open(RECOVERED_CSV, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['original', 'matched', 'method', 'country'])
    writer.writeheader()
    writer.writerows(recovered_rows)

# ---------------------------------------------------------------------------
# Aggregate Countries
# ---------------------------------------------------------------------------
countries_data: dict = {}
for c in cities_data.values():
    iso = c['country']
    if iso not in countries_data:
        countries_data[iso] = {
            'iso2': iso,
            'name': c['country_name'],
            'scores': [],
            'city_count': 0,
            'scored_count': 0,
        }
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
        'scored_count': cd['scored_count'],
    })

# ---------------------------------------------------------------------------
# Write output JSONs
# ---------------------------------------------------------------------------
with open(WORLD_CITIES_JSON, 'w', encoding='utf-8') as f:
    json.dump(list(cities_data.values()), f, separators=(',', ':'))

with open(WORLD_COUNTRIES_JSON, 'w', encoding='utf-8') as f:
    json.dump(countries_list, f, separators=(',', ':'))

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
print(f"\nDone. Wrote {len(cities_data)} cities and {len(countries_list)} countries.")
print(f"Geocoding misses: {len(misses)} (see {MISSES_CSV})")
print(f"Recovered:        {len(recovered_rows)} (see {RECOVERED_CSV})")
print(f"\nBreakdown:")
print(f"  Placeholders skipped (silent): {stats['placeholders_skipped']}")
print(f"  Exact match:                   {stats.get('exact', 0)}")
print(f"  Suffix-strip recovery:         {stats.get('suffix', 0)}")
print(f"  Fuzzy recovery:                {stats.get('fuzzy', 0)}")
print(f"  Misses:                        {stats.get('miss', 0)}")

# Validate iso2 codes
invalid = [c for c in cities_data.values() if not re.match(r'^[A-Z]{2}$', c['country']) and c['country'] != 'XK']
if invalid:
    print(f"\nWARNING: {len(invalid)} cities with non-standard iso2:")
    for c in invalid[:5]:
        print(f"  {c['country']!r} — {c['name']}")
else:
    print("\nAll iso2 codes valid (^[A-Z]{2}$ or XK).")

# Check Sweden
se_cities = [c for c in cities_data.values() if c['country'] == 'SE']
print(f"\nSweden (SE): {len(se_cities)} cities.")
if se_cities:
    print(f"  Sample: {', '.join(c['name'] for c in se_cities[:5])}")
