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

        after_nonlatin  = has_non_latin(after)
        before_nonlatin = has_non_latin(before)

        if not after_nonlatin and _is_useful_name(after):
            # Clean Latin product name → use it
            return after
        elif not before_nonlatin:
            # Latin brand, non-Latin product → use Latin brand (first token)
            brand = before.split(',')[0].strip()
            if after_nonlatin:
                # append transliterated product for Cyrillic
                after_tr = transliterate(after) if all(
                    _char_script(c) == 'CYRILLIC' or not c.strip() for c in after
                ) else ''
                return (brand + (' – ' + after_tr if after_tr else '')).strip(' –')
            return brand
        else:
            # Both non-Latin: try to salvage Latin from before
            latin_brand = _extract_latin_from(before)
            if latin_brand:
                return latin_brand
            # Transliterate Cyrillic
            tr = transliterate(s)
            if not has_non_latin(tr):
                # Clean up double spaces
                return ' '.join(tr.split())
            # Remove non-Latin chars (Arabic/Hebrew/etc.)
            cleaned = ''.join(c for c in s if _char_script(c) == 'LATIN' or ord(c) < 128)
            return ' '.join(cleaned.split()).strip(' -,')

    # No separator: just fix encoding and transliterate if needed
    if has_non_latin(s):
        tr = transliterate(s)
        if not has_non_latin(tr):
            return ' '.join(tr.split())
        # Strip non-Latin (Arabic/Hebrew/CJK)
        s = ''.join(c for c in s if _char_script(c) == 'LATIN' or ord(c) < 128)
        s = ' '.join(s.split()).strip(' -,')
    return s


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

src = r'C:\Repos\bottled-water-db\eaux_bouteille.json'
dst = os.path.join(os.path.dirname(__file__), '..', 'public', 'eaux_masse.json')

with open(src, encoding='latin-1') as f:
    data = json.load(f)

out = []
skipped_name = 0
for w in data:
    wid = str(w.get('id', ''))
    if wid in CURATED_IDS:
        continue
    # Must be scorable
    if w.get('calcium_mg_l') is None or w.get('bicarbonate_mg_l') is None:
        continue

    nom = clean_nom(w.get('nom', ''))
    if not nom:
        skipped_name += 1
        continue

    pays_raw  = fix_str(w.get('pays', ''))
    pays      = PAYS_MAP.get(pays_raw, pays_raw) or 'Inconnu'

    out.append({
        'id':               wid,
        'nom':              nom,
        'pays':             pays,
        'ville_origine':    fix_str(w.get('ville_origine')) or 'Inconnu',
        'entreprise':       fix_str(w.get('entreprise')) or '',
        'type_eau':         fix_str(w.get('type_eau'))  or 'Plate',
        'categorie':        fix_str(w.get('categorie')) or 'Source',
        'ph':               round_val(w.get('ph')),
        'tds_mg_l':         round_val(w.get('tds_mg_l')),
        'calcium_mg_l':     round_val(w.get('calcium_mg_l')),
        'magnesium_mg_l':   round_val(w.get('magnesium_mg_l')),
        'sodium_mg_l':      round_val(w.get('sodium_mg_l')),
        'potassium_mg_l':   round_val(w.get('potassium_mg_l')),
        'bicarbonate_mg_l': round_val(w.get('bicarbonate_mg_l')),
        'sulfate_mg_l':     round_val(w.get('sulfate_mg_l')),
        'chlorure_mg_l':    round_val(w.get('chlorure_mg_l')),
        'silice_mg_l':      round_val(w.get('silice_mg_l')),
        'nitrate_mg_l':     round_val(w.get('nitrate_mg_l')),
    })

compact = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
with open(dst, 'w', encoding='utf-8') as f:
    f.write(compact)

print(f'Ecrit: {len(out)} entrees -> {dst}')
print(f'Saute (nom vide apres nettoyage): {skipped_name}')
print(f'Taille: {len(compact)//1024} KB')
print('OK')
