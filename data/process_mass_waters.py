"""
Preprocesses eaux_bouteille.json (OpenFoodFacts harvest) into a compact JSON
for the bottled water page. Excludes the 44 curated entries already embedded
in bottled.js, keeps only scorable entries (Ca + Bic present).
"""
import json, os, unicodedata

CURATED_IDS = {
    'evian','volvic','vittel','contrex','hepar','badoit','perrier',
    'san_pellegrino','acqua_panna','fiji','cristaline','rozana',
    'vichy_celestins','saint_yorre','gerolsteiner','borjomi','courmayeur',
    'spa_reine','wattwiller','mont_roucous','chateldon','highland_spring',
    'buxton','san_benedetto','solan_de_cabras','voss','dasani','smartwater',
    'vichy_catalan','pedras_mod','radenska','ferrarelle','luso',
    'icelandic_glacial','velleminfroy','abatilles','lanjaron','hildon',
    'liquid_death','quezac','veen_velvet','jeju_samdasoo',
    'suntory_tennensui','nongfu_spring',
}

# English → French country names
PAYS_MAP = {
    'Germany':          'Allemagne',
    'United States':    'États-Unis',
    'Spain':            'Espagne',
    'Belgium':          'Belgique',
    'Italy':            'Italie',
    'United Kingdom':   'Royaume-Uni',
    'Netherlands':      'Pays-Bas',
    'Austria':          'Autriche',
    'Switzerland':      'Suisse',
    'Poland':           'Pologne',
    'Czech Republic':   'République tchèque',
    'Hungary':          'Hongrie',
    'Slovakia':         'Slovaquie',
    'Romania':          'Roumanie',
    'Portugal':         'Portugal',
    'Greece':           'Grèce',
    'Turkey':           'Turquie',
    'Russia':           'Russie',
    'Japan':            'Japon',
    'China':            'Chine',
    'South Korea':      'Corée du Sud',
    'Mexico':           'Mexique',
    'Brazil':           'Brésil',
    'Argentina':        'Argentine',
    'Australia':        'Australie',
    'New Zealand':      'Nouvelle-Zélande',
    'Canada':           'Canada',
    'Morocco':          'Maroc',
    'Algeria':          'Algérie',
    'Tunisia':          'Tunisie',
    'South Africa':     'Afrique du Sud',
    'Israel':           'Israël',
    'Lebanon':          'Liban',
    'Norway':           'Norvège',
    'Sweden':           'Suède',
    'Finland':          'Finlande',
    'Denmark':          'Danemark',
    'Iceland':          'Islande',
    'Croatia':          'Croatie',
    'Slovenia':         'Slovénie',
    'Serbia':           'Serbie',
    'Georgia':          'Géorgie',
    'Latvia':           'Lettonie',
    'Lithuania':        'Lituanie',
    'Estonia':          'Estonie',
    'Bulgaria':         'Bulgarie',
    'Ukraine':          'Ukraine',
    'Colombia':         'Colombie',
    'Chile':            'Chili',
    'Peru':             'Pérou',
    'Thailand':         'Thaïlande',
    'India':            'Inde',
    'Indonesia':        'Indonésie',
    'Malaysia':         'Malaisie',
    'Vietnam':          'Vietnam',
    'Taiwan':           'Taïwan',
    'Singapore':        'Singapour',
    'Luxembourg':       'Luxembourg',
    'ישראל':            'Israël',   # Israël en hébreu
    'Andorra':          'Andorre',
    'Albania':          'Albanie',
    'Belarus':          'Biélorussie',
    'Bolivia':          'Bolivie',
    'Cambodia':         'Cambodge',
    'Cameroon':         'Cameroun',
    'Cuba':             'Cuba',
    'Gabon':            'Gabon',
    'Ireland':          'Irlande',
    'Madagascar':       'Madagascar',
    'Qatar':            'Qatar',
    'Saudi Arabia':     'Arabie saoudite',
    'Senegal':          'Sénégal',
    'Yemen':            'Yémen',
    'United Arab Emirates': 'Émirats arabes unis',
    'Hong Kong':        'Hong Kong',
    'Burkina Faso':     'Burkina Faso',
}

# ── Encoding fix ──────────────────────────────────────────────────────────────
def fix_mojibake(s):
    """Fix UTF-8 text that was stored and read as latin-1.

    OpenFoodFacts JSON has mixed encoding: some entries use single-byte latin-1
    for accented chars (é = 0xE9), others have UTF-8 multi-byte sequences stored
    as raw bytes. The segment approach fixes each mojibake pair independently,
    preserving correctly-decoded latin-1 chars.
    """
    if not s:
        return s
    s = str(s)
    result = []
    i = 0
    while i < len(s):
        o = ord(s[i])
        # 2-byte UTF-8 lead (0xC2–0xDF) + continuation (0x80–0xBF)
        if 0xC2 <= o <= 0xDF and i + 1 < len(s) and 0x80 <= ord(s[i + 1]) <= 0xBF:
            try:
                result.append(s[i:i + 2].encode('latin-1').decode('utf-8'))
                i += 2
                continue
            except Exception:
                pass
        # 3-byte UTF-8 lead (0xE0–0xEF) + two continuations
        elif (0xE0 <= o <= 0xEF and i + 2 < len(s)
              and 0x80 <= ord(s[i + 1]) <= 0xBF
              and 0x80 <= ord(s[i + 2]) <= 0xBF):
            try:
                result.append(s[i:i + 3].encode('latin-1').decode('utf-8'))
                i += 3
                continue
            except Exception:
                pass
        result.append(s[i])
        i += 1
    return ''.join(result)


# ── Non-Latin script handling ─────────────────────────────────────────────────
NON_LATIN_SCRIPTS = ('CYRILLIC', 'ARABIC', 'HEBREW', 'CJK', 'HIRAGANA', 'KATAKANA',
                     'HANGUL', 'THAI', 'GEORGIAN', 'ARMENIAN')

def _char_script(c):
    if ord(c) <= 127:
        return 'LATIN'
    n = unicodedata.name(c, '')
    for sc in NON_LATIN_SCRIPTS:
        if n.startswith(sc):
            return sc
    return 'LATIN'  # latin extended, diacritics, etc.

def has_non_latin(s):
    return any(_char_script(c) not in ('LATIN',) for c in s if c.strip())

# Cyrillic → Latin transliteration (Bulgarian/Russian/Ukrainian)
_CYR = {
    'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'Zh',
    'З':'Z','И':'I','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O',
    'П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts',
    'Ч':'Ch','Ш':'Sh','Щ':'Sht','Ь':'','Ъ':'','Ю':'Yu','Я':'Ya',
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
    'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
    'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
    'ч':'ch','ш':'sh','щ':'sht','ь':'','ъ':'','ю':'yu','я':'ya',
    # Ukrainian
    'Є':'Ye','І':'I','Ї':'Yi','Ґ':'G','є':'ye','і':'i','ї':'yi','ґ':'g',
}

def transliterate(s):
    return ''.join(_CYR.get(c, c) for c in s)


# ── Name cleaning ─────────────────────────────────────────────────────────────
def _is_useful_name(s):
    """True if string is a meaningful product name (not too generic)."""
    s = s.strip().lower()
    generic = {'eau', 'water', 'wasser', 'agua', 'acqua', 'voda', 'pani',
               'eau minerale', 'mineral water', 'natural water'}
    return len(s) >= 3 and s not in generic

def _extract_latin_from(s):
    """From a mixed Brand, Бренд string, return the first Latin-only token."""
    for part in s.split(','):
        part = part.strip()
        if part and not has_non_latin(part):
            return part
    return ''

def strip_packaging(s):
    """Remove volume/container references from a product name."""
    # German retailer price descriptions (e.g. "0.50€ ( Angebot ) 5.99€ + Pfand")
    s = re.sub(r'\s*\d[\d\s,\.]*\s*€.*$', '', s).strip()

    # Parenthetical groups that contain a volume: (330 ML), (12 x 75 cl), (6x1,5l)
    s = re.sub(r'\s*\([^)]*\b\d[\d,\.]*\s*(?:ml|cl|l|lt)\b[^)]*\)', '', s, flags=re.I)

    # Multi-pack volumes: 6x1.5L, 12 x 1 l, pack de 6x50cl
    s = re.sub(r'\b(?:pack\s+de\s+)?\d+\s*[x×]\s*\d[\d,\.]*\s*(?:ml|cl|l|lt)\b', '', s, flags=re.I)

    # Alphanumeric code concatenated with volume: Spk500ml, Sportscap330ml
    s = re.sub(r'\b[A-Za-z]+\d[\d,\.]*\s*(?:ml|cl|l|lt)\b', '', s, flags=re.I)

    # Simple volumes: 0.5L, 1.5 L, 50cl, 500ml, 2 lt, 330 ML, 6L
    s = re.sub(r'\b\d[\d,\.]*\s*(?:ml|cl|l|lt)\b', '', s, flags=re.I)

    # Standalone container codes
    s = re.sub(r'\bPET\b', '', s)
    s = re.sub(r'\bEW\b', '', s)

    # "Kiste" (German crate): strip leading occurrence, then mid/trailing + everything after
    s = re.sub(r'^kiste\b\s*', '', s, flags=re.I)
    s = re.sub(r'\s*,?\s*\bkiste\b.*$', '', s, flags=re.I)

    # Variant/container descriptors
    s = re.sub(r'\bsportscap\b', '', s, flags=re.I)
    s = re.sub(r'\bsportcap\b', '', s, flags=re.I)
    s = re.sub(r'\bcanette\b', '', s, flags=re.I)
    s = re.sub(r'\bkids?\b', '', s, flags=re.I)
    s = re.sub(r'\bpack\b', '', s, flags=re.I)

    s = re.sub(r'\s+', ' ', s).strip(' -–—,.()')
    return s

def clean_nom(raw):
    """Fix encoding and extract a clean product name from OpenFoodFacts format."""
    s = fix_mojibake(str(raw or '').strip())
    if not s:
        return ''

    # OpenFoodFacts format: "Brand(s) - Product name"
    if ' - ' in s:
        before, after = s.split(' - ', 1)
        before = before.strip()
        after  = after.strip()
        after_stripped = strip_packaging(after)

        after_nonlatin  = has_non_latin(after)
        before_nonlatin = has_non_latin(before)

        if not after_nonlatin and _is_useful_name(after_stripped):
            # Clean Latin product name → use it
            return after_stripped
        elif not before_nonlatin:
            # Latin brand, non-Latin product → use Latin brand (first token)
            brand = before.split(',')[0].strip()
            if after_nonlatin:
                # append transliterated product for Cyrillic
                after_tr = transliterate(after) if all(
                    _char_script(c) == 'CYRILLIC' or not c.strip() for c in after
                ) else ''
                return strip_packaging((brand + (' – ' + after_tr if after_tr else '')).strip(' –'))
            return strip_packaging(brand)
        else:
            # Both non-Latin: try to salvage Latin from before
            latin_brand = _extract_latin_from(before)
            if latin_brand:
                return strip_packaging(latin_brand)
            # Transliterate Cyrillic
            tr = transliterate(s)
            if not has_non_latin(tr):
                return strip_packaging(' '.join(tr.split()))
            # Remove non-Latin chars (Arabic/Hebrew/etc.)
            cleaned = ''.join(c for c in s if _char_script(c) == 'LATIN' or ord(c) < 128)
            return strip_packaging(' '.join(cleaned.split()).strip(' -,'))

    # No separator: just fix encoding and transliterate if needed
    if has_non_latin(s):
        tr = transliterate(s)
        if not has_non_latin(tr):
            return strip_packaging(' '.join(tr.split()))
        # Strip non-Latin (Arabic/Hebrew/CJK)
        s = ''.join(c for c in s if _char_script(c) == 'LATIN' or ord(c) < 128)
        s = ' '.join(s.split()).strip(' -,')
    return strip_packaging(s)


def fix_str(s):
    """Fix encoding only (for pays/ville/entreprise — no nom cleanup)."""
    return fix_mojibake(str(s or '').strip())


# ── Main ──────────────────────────────────────────────────────────────────────
def round_val(v):
    if v is None:
        return None
    if isinstance(v, float):
        r = round(v, 2)
        return int(r) if r == int(r) else r
    return v


# ── Corrections / suppressions manuelles ─────────────────────────────────────
# Entrées à supprimer après analyse (doublon ou erreur irréparable)
DROP_IDS = {
    # MONTCALM typo : off_5400113017486 ('Mont calm') a ca=3, bic=6.8 —
    # toutes les valeurs sont ~10× trop petites (erreur de virgule décimale).
    # off_3256225040629 ('Eau minérale MONTCALM 6x1,5l') couvre cette référence
    # avec les valeurs correctes ca=30, bic=52. On supprime le doublon.
    'off_5400113017486',
}

# id → overrides appliqués AVANT les filtres de validité
CORRECTIONS = {}


# ── Déduplication ─────────────────────────────────────────────────────────────
import re, unicodedata as _ud

def _norm_nom(s):
    """Clé de déduplication : minuscules, sans accents, sans ponctuation/taille."""
    # Supprimer mentions de volume (ex: "6x1,5l", "1.5l", "50cl")
    s = re.sub(r'\b\d+[x×]\d[\d,\.]*\s*(?:ml|cl|l|lt)\b', '', s, flags=re.I)
    s = re.sub(r'\b\d[\d,\.]*\s*(?:ml|cl|l|lt)\b', '', s, flags=re.I)
    # Normaliser
    s = _ud.normalize('NFD', s.lower())
    s = ''.join(c for c in s if _ud.category(c) != 'Mn')   # strip diacritics
    s = re.sub(r'[^a-z0-9]', '', s)
    return s


# ── Main ──────────────────────────────────────────────────────────────────────
src = r'C:\Repos\bottled-water-db\eaux_bouteille.json'
dst = os.path.join(os.path.dirname(__file__), '..', 'public', 'eaux_masse.json')

with open(src, encoding='latin-1') as f:
    data = json.load(f)

raw_entries = []
skipped = {'curated': 0, 'no_ca_bic': 0, 'zero_ca_bic': 0,
           'bad_data': 0, 'empty_nom': 0}

for w in data:
    wid = str(w.get('id', ''))
    if wid in CURATED_IDS:
        skipped['curated'] += 1
        continue
    if wid in DROP_IDS:
        skipped['curated'] += 1   # compte dans le même compteur
        continue

    # Corrections manuelles
    if wid in CORRECTIONS:
        w = {**w, **CORRECTIONS[wid]}

    ca  = w.get('calcium_mg_l')
    bic = w.get('bicarbonate_mg_l')
    tds = w.get('tds_mg_l')

    # Doit avoir Ca ET Bic non nuls
    if ca is None or bic is None:
        skipped['no_ca_bic'] += 1
        continue
    if ca == 0 or bic == 0:
        skipped['zero_ca_bic'] += 1
        continue

    # Filtre données aberrantes : valeurs vraisemblablement dans la mauvaise unité
    # (ex: Ca=0.02 avec TDS=0.5 → clairement en g/L au lieu de mg/L)
    if ca < 0.3:
        skipped['bad_data'] += 1
        continue
    if bic < 0.5:
        skipped['bad_data'] += 1
        continue
    if tds is not None and tds < 2.0:
        skipped['bad_data'] += 1
        continue

    nom = clean_nom(w.get('nom', ''))
    if not nom:
        skipped['empty_nom'] += 1
        continue

    pays_raw = fix_str(w.get('pays', ''))
    pays     = PAYS_MAP.get(pays_raw, pays_raw) or 'Inconnu'

    raw_entries.append({
        'id':               wid,
        'nom':              nom,
        'pays':             pays,
        'ville_origine':    fix_str(w.get('ville_origine')) or 'Inconnu',
        'entreprise':       fix_str(w.get('entreprise')) or '',
        'type_eau':         fix_str(w.get('type_eau'))  or 'Plate',
        'categorie':        fix_str(w.get('categorie')) or 'Source',
        'ph':               round_val(w.get('ph')),
        'tds_mg_l':         round_val(tds),
        'calcium_mg_l':     round_val(ca),
        'magnesium_mg_l':   round_val(w.get('magnesium_mg_l')),
        'sodium_mg_l':      round_val(w.get('sodium_mg_l')),
        'potassium_mg_l':   round_val(w.get('potassium_mg_l')),
        'bicarbonate_mg_l': round_val(bic),
        'sulfate_mg_l':     round_val(w.get('sulfate_mg_l')),
        'chlorure_mg_l':    round_val(w.get('chlorure_mg_l')),
        'silice_mg_l':      round_val(w.get('silice_mg_l')),
        'nitrate_mg_l':     round_val(w.get('nitrate_mg_l')),
        '_norm': _norm_nom(nom),
    })

# ── Déduplication : même nom normalisé + même (Ca, Bic) → garder un seul ──
# On préfère l'entrée avec le plus de champs renseignés.
DEDUP_FIELDS = ['ph','tds_mg_l','magnesium_mg_l','sodium_mg_l',
                'potassium_mg_l','sulfate_mg_l','chlorure_mg_l']

def _richness(e):
    return sum(1 for f in DEDUP_FIELDS if e.get(f) is not None)

from collections import defaultdict
dedup_groups = defaultdict(list)
for e in raw_entries:
    key = (e['_norm'], e['calcium_mg_l'], e['bicarbonate_mg_l'])
    dedup_groups[key].append(e)

out = []
dupes_removed = 0
for key, group in dedup_groups.items():
    best = max(group, key=_richness)
    out.append(best)
    dupes_removed += len(group) - 1

# Supprimer la clé temporaire
for e in out:
    del e['_norm']

compact = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
with open(dst, 'w', encoding='utf-8') as f:
    f.write(compact)

print(f'Source : {len(data)} entrees')
print(f'Sautes  : {skipped}')
print(f'Doublons supprimes : {dupes_removed}')
print(f'Ecrit   : {len(out)} entrees -> {dst}')
print(f'Taille  : {len(compact)//1024} KB')
print('OK')
