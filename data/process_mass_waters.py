"""
Preprocesses eaux_bouteille.json (OpenFoodFacts harvest) into a compact JSON
for the bottled water page. Excludes the 44 curated entries already embedded
in bottled.js.
"""
import json, sys, os

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

# Normalise les noms de pays anglais → français (les plus fréquents)
PAYS_MAP = {
    'Germany':        'Allemagne',
    'United States':  'États-Unis',
    'Spain':          'Espagne',
    'Belgium':        'Belgique',
    'Italy':          'Italie',
    'United Kingdom': 'Royaume-Uni',
    'Netherlands':    'Pays-Bas',
    'Austria':        'Autriche',
    'Switzerland':    'Suisse',
    'Poland':         'Pologne',
    'Czech Republic': 'République tchèque',
    'Hungary':        'Hongrie',
    'Slovakia':       'Slovaquie',
    'Romania':        'Roumanie',
    'Portugal':       'Portugal',
    'Greece':         'Grèce',
    'Turkey':         'Turquie',
    'Russia':         'Russie',
    'Japan':          'Japon',
    'China':          'Chine',
    'South Korea':    'Corée du Sud',
    'Mexico':         'Mexique',
    'Brazil':         'Brésil',
    'Argentina':      'Argentine',
    'Australia':      'Australie',
    'New Zealand':    'Nouvelle-Zélande',
    'Canada':         'Canada',
    'Morocco':        'Maroc',
    'Algeria':        'Algérie',
    'Tunisia':        'Tunisie',
    'South Africa':   'Afrique du Sud',
    'Israel':         'Israël',
    'Lebanon':        'Liban',
    'Norway':         'Norvège',
    'Sweden':         'Suède',
    'Finland':        'Finlande',
    'Denmark':        'Danemark',
    'Iceland':        'Islande',
    'Croatia':        'Croatie',
    'Slovenia':       'Slovénie',
    'Serbia':         'Serbie',
    'Georgia':        'Géorgie',
    'Latvia':         'Lettonie',
    'Lithuania':      'Lituanie',
    'Estonia':        'Estonie',
    'Bulgaria':       'Bulgarie',
    'Ukraine':        'Ukraine',
    'Colombia':       'Colombie',
    'Chile':          'Chili',
    'Peru':           'Pérou',
    'Thailand':       'Thaïlande',
    'India':          'Inde',
    'Indonesia':      'Indonésie',
    'Malaysia':       'Malaisie',
    'Vietnam':        'Vietnam',
    'Taiwan':         'Taïwan',
    'Singapore':      'Singapour',
    'Luxembourg':     'Luxembourg',
}

def round_val(v):
    if v is None:
        return None
    if isinstance(v, float):
        # Round to 2 decimal places max, drop trailing zeros
        r = round(v, 2)
        return int(r) if r == int(r) else r
    return v

src = r'C:\Repos\bottled-water-db\eaux_bouteille.json'
dst = os.path.join(os.path.dirname(__file__), '..', 'public', 'eaux_masse.json')

with open(src, encoding='latin-1') as f:
    data = json.load(f)

out = []
for w in data:
    wid = str(w.get('id', ''))
    # Skip curated entries (already in bottled.js inline)
    if wid in CURATED_IDS:
        continue
    # Must have a name
    nom = (w.get('nom') or '').strip()
    if not nom:
        continue
    # Must be scorable (Ca + Bic required for SCA score)
    if w.get('calcium_mg_l') is None or w.get('bicarbonate_mg_l') is None:
        continue

    pays = PAYS_MAP.get(w.get('pays', ''), w.get('pays', ''))

    out.append({
        'id':               wid,
        'nom':              nom,
        'pays':             pays,
        'ville_origine':    w.get('ville_origine') or 'Inconnu',
        'entreprise':       w.get('entreprise') or '',
        'type_eau':         w.get('type_eau') or 'Plate',
        'categorie':        w.get('categorie') or 'Source',
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
print(f'Taille: {len(compact)//1024} KB')
ca_bic = sum(1 for w in out if w['calcium_mg_l'] is not None and w['bicarbonate_mg_l'] is not None)
print(f'Scorables (Ca+Bic): {ca_bic} ({ca_bic*100//len(out)}%)')
print('OK')
