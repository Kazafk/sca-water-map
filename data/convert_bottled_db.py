"""
Converts all YAML files from bottled-water-db into curated_waters.json
for use by sca-water-map/public/bottled.js.

Usage: python data/convert_bottled_db.py
Output: public/curated_waters.json
"""
import json
import os
import yaml
from pathlib import Path

DB_PATH = Path(r'C:\Repos\bottled-water-db\brands')
OUT_PATH = Path(os.path.dirname(__file__)) / '..' / 'public' / 'curated_waters.json'

# English country names → French
PAYS_MAP = {
    'France': 'France',
    'Germany': 'Allemagne',
    'Italy': 'Italie',
    'Spain': 'Espagne',
    'Portugal': 'Portugal',
    'Belgium': 'Belgique',
    'Switzerland': 'Suisse',
    'Austria': 'Autriche',
    'Netherlands': 'Pays-Bas',
    'Norway': 'Norvège',
    'Sweden': 'Suède',
    'Finland': 'Finlande',
    'Denmark': 'Danemark',
    'Iceland': 'Islande',
    'Ireland': 'Irlande',
    'United Kingdom': 'Royaume-Uni',
    'Poland': 'Pologne',
    'Czech Republic': 'République tchèque',
    'Slovakia': 'Slovaquie',
    'Hungary': 'Hongrie',
    'Romania': 'Roumanie',
    'Bulgaria': 'Bulgarie',
    'Croatia': 'Croatie',
    'Slovenia': 'Slovénie',
    'Serbia': 'Serbie',
    'Kosovo': 'Kosovo',
    'North Macedonia': 'Macédoine du Nord',
    'Albania': 'Albanie',
    'Greece': 'Grèce',
    'Ukraine': 'Ukraine',
    'Belarus': 'Biélorussie',
    'Moldova': 'Moldavie',
    'Russia': 'Russie',
    'Georgia': 'Géorgie',
    'Estonia': 'Estonie',
    'Latvia': 'Lettonie',
    'Lithuania': 'Lituanie',
    'Malta': 'Malte',
    'Cyprus': 'Chypre',
    'United States': 'États-Unis',
    'Canada': 'Canada',
    'Mexico': 'Mexique',
    'Brazil': 'Brésil',
    'Argentina': 'Argentine',
    'Chile': 'Chili',
    'Peru': 'Pérou',
    'Colombia': 'Colombie',
    'Japan': 'Japon',
    'China': 'Chine',
    'South Korea': 'Corée du Sud',
    'India': 'Inde',
    'Indonesia': 'Indonésie',
    'Vietnam': 'Vietnam',
    'Thailand': 'Thaïlande',
    'Malaysia': 'Malaisie',
    'Singapore': 'Singapour',
    'Taiwan': 'Taïwan',
    'Fiji': 'Fidji',
    'Australia': 'Australie',
    'New Zealand': 'Nouvelle-Zélande',
    'Morocco': 'Maroc',
    'Algeria': 'Algérie',
    'Tunisia': 'Tunisie',
    'South Africa': 'Afrique du Sud',
    'Egypt': 'Égypte',
    'Israel': 'Israël',
    'Saudi Arabia': 'Arabie saoudite',
    'Lebanon': 'Liban',
    'Turkey': 'Turquie',
    'Luxembourg': 'Luxembourg',
    'Andorra': 'Andorre',
}

# source_type → catégorie JS (compatible avec les filtres existants)
SOURCE_TYPE_MAP = {
    'spring':         'Minérale',
    'mineral_spring': 'Minérale',
    'artesian':       'Artésienne',
    'thermal_spring': 'Thermale',
    'glacial':        'Source',
    'well':           'Source',
    'purified':       'Purifiée',
}

# water_type → type_eau JS
WATER_TYPE_MAP = {
    'still':          'Plate',
    'sparkling':      'Gazeuse',
    'sparkling_still': 'Plate',   # disponible aussi gazeuse, on prend le still
}


def round_val(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        r = round(float(v), 2)
        return int(r) if r == int(r) else r
    return v


def convert_yaml(path: Path) -> dict | None:
    with open(path, encoding='utf-8') as f:
        data = yaml.safe_load(f)

    if not data or not isinstance(data, dict):
        return None

    comp = data.get('composition') or {}

    ca  = comp.get('calcium_mg_l')
    bic = comp.get('bicarbonate_mg_l')
    # On garde les entrées sans Ca/Bic (elles apparaîtront avec score null dans le tableau)
    # mais les valeurs doivent être numériques si présentes
    if ca is not None and not isinstance(ca, (int, float)):
        ca = None
    if bic is not None and not isinstance(bic, (int, float)):
        bic = None

    slug = data.get('slug') or path.stem
    country_en = data.get('country_origin', '')
    pays = PAYS_MAP.get(country_en, country_en)

    source_type = data.get('source_type', 'spring')
    water_type  = data.get('water_type', 'still')
    # water_type peut contenir des commentaires YAML inline (ex: "still  # aussi gazeuse")
    if isinstance(water_type, str):
        water_type = water_type.split('#')[0].strip()

    notes = data.get('notes', '') or ''
    description = ' '.join(str(notes).strip().split()) if notes else ''

    # Construire ville_origine : source_location ou source_name + region
    ville = data.get('source_location') or ''
    if not ville:
        source_name = data.get('source_name') or ''
        region      = data.get('region_origin') or ''
        ville = f'{source_name} ({region})' if source_name and region else source_name or region

    return {
        'id':               slug,
        'nom':              data.get('name', slug),
        'pays':             pays,
        'ville_origine':    ville,
        'entreprise':       data.get('brand_owner') or data.get('parent_group') or '',
        'type_eau':         WATER_TYPE_MAP.get(water_type, 'Plate'),
        'categorie':        SOURCE_TYPE_MAP.get(source_type, 'Minérale'),
        'ph':               round_val(comp.get('pH')),
        'tds_mg_l':         round_val(comp.get('TDS_mg_l')),
        'calcium_mg_l':     round_val(ca),
        'magnesium_mg_l':   round_val(comp.get('magnesium_mg_l')),
        'sodium_mg_l':      round_val(comp.get('sodium_mg_l')),
        'potassium_mg_l':   round_val(comp.get('potassium_mg_l')),
        'bicarbonate_mg_l': round_val(bic),
        'sulfate_mg_l':     round_val(comp.get('sulfate_mg_l')),
        'chlorure_mg_l':    round_val(comp.get('chloride_mg_l')),
        'silice_mg_l':      round_val(comp.get('silica_mg_l')),
        'nitrate_mg_l':     round_val(comp.get('nitrate_mg_l')),
        'description':      description,
        '_verified':        bool(data.get('composition_complete', False)),
    }


def main():
    entries = []
    skipped = []

    for yaml_path in sorted(DB_PATH.rglob('*.yaml')):
        try:
            entry = convert_yaml(yaml_path)
            if entry:
                entries.append(entry)
            else:
                skipped.append(str(yaml_path.relative_to(DB_PATH)))
        except Exception as e:
            print(f'  ⚠ Erreur {yaml_path.name}: {e}')

    # Tri : pays puis nom
    entries.sort(key=lambda e: (e['pays'], e['nom'].lower()))

    out_path = OUT_PATH.resolve()
    compact  = json.dumps(entries, ensure_ascii=False, separators=(',', ':'), indent=None)
    out_path.write_text(compact, encoding='utf-8')

    scorable = sum(1 for e in entries if e['calcium_mg_l'] is not None and e['bicarbonate_mg_l'] is not None)

    print(f'Fichiers YAML lus   : {len(entries) + len(skipped)}')
    print(f'Entrées converties  : {len(entries)}')
    print(f'  dont scorables    : {scorable}')
    print(f'Ignorés (vides)     : {len(skipped)}')
    print(f'Sortie              : {out_path}')
    print(f'Taille              : {len(compact) // 1024} KB')
    print('OK')


if __name__ == '__main__':
    main()
