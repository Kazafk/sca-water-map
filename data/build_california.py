"""
build_california.py
===================
Import California tap-water chemistry data from the SWRCB EDT/SDWIS database
and emit data/world/usa_california_water_quality.json for consumption by
build_world.py.

Sources
-------
Chemistry : SDWIS4.zip (tab-delimited SDWIS4.tab, ~2.2 GB uncompressed)
            https://www.waterboards.ca.gov/drinking_water/certlic/drinkingwater/
            documents/edtlibrary/SDWIS4.zip
Water-system directory : watsys_as_excel.zip  (watsys.xlsx, ~1.4 MB)
            https://www.waterboards.ca.gov/drinking_water/certlic/drinkingwater/
            documents/edtlibrary/watsys_as_excel.zip

Idempotent: already-downloaded files are not re-fetched.
"""

import csv
import io
import json
import math
import os
import subprocess
import sys
import zipfile
from collections import defaultdict
from statistics import median
from typing import Optional

import openpyxl

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
EDT_DIR = os.path.join(_HERE, "edt")
WORLD_DIR = os.path.join(_HERE, "world")
OUTPUT_FILE = os.path.join(WORLD_DIR, "usa_california_water_quality.json")

SDWIS_ZIP_URL = (
    "https://www.waterboards.ca.gov/drinking_water/certlic/drinkingwater/"
    "documents/edtlibrary/SDWIS4.zip"
)
WATSYS_ZIP_URL = (
    "https://www.waterboards.ca.gov/drinking_water/certlic/drinkingwater/"
    "documents/edtlibrary/watsys_as_excel.zip"
)

SDWIS_ZIP = os.path.join(EDT_DIR, "SDWIS4.zip")
WATSYS_ZIP = os.path.join(EDT_DIR, "watsys_as_excel.zip")
WATSYS_XLSX = os.path.join(EDT_DIR, "watsys.xlsx")

# ---------------------------------------------------------------------------
# Analyte names in SDWIS4.tab that map to our SCA parameters
# ---------------------------------------------------------------------------
# Priority order within each parameter: first match wins for a given system.
ANALYTE_HARDNESS = "HARDNESS, TOTAL (AS CACO3)"
ANALYTE_ALKALINITY_TOTAL = "ALKALINITY, TOTAL"
ANALYTE_ALKALINITY_BICARB = "ALKALINITY, BICARBONATE"
ANALYTE_PH_LAB = "PH"
ANALYTE_PH_FIELD = "PH, FIELD"
ANALYTE_TDS = "TDS"
ANALYTE_CONDUCTIVITY = "CONDUCTIVITY @ 25 C UMHOS/CM"
ANALYTE_SODIUM = "SODIUM"
ANALYTE_CHLORIDE = "CHLORIDE"

# Set of all analytes we want to collect
TARGET_ANALYTES = {
    ANALYTE_HARDNESS,
    ANALYTE_ALKALINITY_TOTAL,
    ANALYTE_ALKALINITY_BICARB,
    ANALYTE_PH_LAB,
    ANALYTE_PH_FIELD,
    ANALYTE_TDS,
    ANALYTE_CONDUCTIVITY,
    ANALYTE_SODIUM,
    ANALYTE_CHLORIDE,
}

# ---------------------------------------------------------------------------
# Sanity bounds per parameter (values outside are excluded as aberrant)
# ---------------------------------------------------------------------------
BOUNDS: dict[str, tuple[float, float]] = {
    "hardness": (0.0, 2000.0),    # mg/L CaCO3
    "alkalinity": (0.0, 1000.0),  # mg/L CaCO3
    "ph": (4.0, 11.0),
    "tds": (0.0, 5000.0),         # mg/L
    "conductivity": (0.0, 10000.0),  # µS/cm
    "sodium": (0.0, 1000.0),      # mg/L
    "chloride": (0.0, 2000.0),    # mg/L
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _log(msg: str) -> None:
    print(msg, flush=True)


def _download_if_missing(url: str, dest: str, expected_size: Optional[int] = None) -> None:
    """Download *url* to *dest* using curl with resume support.

    Args:
        url: Source URL.
        dest: Destination file path.
        expected_size: If provided, skip download when existing file matches.
    """
    if os.path.exists(dest):
        actual_size = os.path.getsize(dest)
        if expected_size is None or actual_size == expected_size:
            _log(f"  [cache] {os.path.basename(dest)} already present ({actual_size:,} bytes)")
            return
        _log(f"  [resume] {os.path.basename(dest)} partial ({actual_size:,}/{expected_size:,})")

    _log(f"  Downloading {os.path.basename(dest)} from {url} ...")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    result = subprocess.run(
        ["curl", "-L", "-C", "-", "-o", dest, url],
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"curl failed for {url}")
    _log(f"  Done: {os.path.getsize(dest):,} bytes")


def _in_bounds(param: str, value: float) -> bool:
    lo, hi = BOUNDS[param]
    return lo <= value <= hi


def _parse_result(
    result_str: str,
    less_than: str,
    reporting_level_str: str,
) -> Optional[float]:
    """Parse a SDWIS result field.

    Non-detects (Less Than Reporting Level == 'Y') are returned as half the
    reporting level (RL / 2).  Empty or negative results return None.

    Args:
        result_str: Raw 'Result' field value.
        less_than: 'Less Than Reporting Level' field ('Y' or 'N').
        reporting_level_str: 'Reporting Level' field value.

    Returns:
        Parsed float or None if unparseable / invalid.
    """
    result_str = result_str.strip()
    less_than = less_than.strip().upper()

    if less_than == "Y":
        try:
            rl = float(reporting_level_str.strip())
            return rl / 2.0 if rl > 0 else None
        except (ValueError, AttributeError):
            return None

    if not result_str:
        return None

    try:
        val = float(result_str)
    except ValueError:
        return None

    return val if val > 0 else None


# ---------------------------------------------------------------------------
# Step 1 — Download source files
# ---------------------------------------------------------------------------


def download_sources() -> None:
    """Ensure SDWIS4.zip and watsys.xlsx are present on disk."""
    _log("=== Step 1: Download source files ===")
    os.makedirs(EDT_DIR, exist_ok=True)
    # SDWIS4.zip — large chemistry file
    _download_if_missing(SDWIS_ZIP_URL, SDWIS_ZIP)
    # Validate zip integrity
    try:
        with zipfile.ZipFile(SDWIS_ZIP, "r") as z:
            names = z.namelist()
            if "SDWIS4.tab" not in names:
                raise ValueError(f"SDWIS4.tab not found in zip — got: {names}")
    except zipfile.BadZipFile as exc:
        raise RuntimeError(f"SDWIS4.zip is corrupt: {exc}") from exc

    # WATSYS xlsx
    _download_if_missing(WATSYS_ZIP_URL, WATSYS_ZIP)
    if not os.path.exists(WATSYS_XLSX):
        with zipfile.ZipFile(WATSYS_ZIP, "r") as z:
            z.extractall(EDT_DIR)
    _log("  All sources ready.")


# ---------------------------------------------------------------------------
# City name normalisations
# ---------------------------------------------------------------------------
# Corrections applied to WATSYS city names before GeoNames lookup.
# Keys are in Title Case (post-title() conversion); values are canonical names
# that GeoNames recognises for the US.  Only genuine GeoNames hits are listed.
_CITY_CORRECTIONS: dict[str, str] = {
    # Abbreviated / truncated names from WATSYS
    "Mt Shasta": "Mount Shasta",
    "Mt. Shasta": "Mount Shasta",
    "W Sacramento": "West Sacramento",
    "Paso Ro": "Paso Robles",
    "Mt Baldy": "Mount Baldy",
    "Mt. Baldy": "Mount Baldy",
    # Inconsistent punctuation / suffixes
    "Snelling,": "Snelling",
    "E. Linda": "Linda",
    "Mtn. Center": "Mountain Center",
    # Garbled / artifact strings
    "0      0P": None,         # exclude
    "200      2P": None,       # exclude
    "Unknown": None,           # exclude
    "Boulder Creek Road": None,  # not a city
    "Seq Nat'L Forest": None,  # not a city
    "Kings Canyon  National P": None,  # national park
    "Yosemite National Park": None,  # national park
    "Fort Hunter Liggett": None,  # military reservation
    "Point Mugu": None,        # naval air station
    "Travis Afb": None,        # Air Force base
    "Mcb Camp Pendleton": None,  # Marine Corps base
    "Camp Roberts": None,      # Army reserve base
}


# ---------------------------------------------------------------------------
# Step 2 — Load WATSYS directory (system number -> city, population)
# ---------------------------------------------------------------------------


def load_watsys() -> tuple[dict[str, str], dict[str, int]]:
    """Load the WATSYS water-system directory from watsys.xlsx.

    Returns:
        Tuple of:
          - sys_to_city: {system_number: city_title_case}
          - sys_to_pop:  {system_number: population}
        System numbers are 7-digit strings matching SDWIS 'Water System Number'
        after stripping the leading 'CA' prefix and trailing whitespace.
    """
    _log("=== Step 2: Load WATSYS directory ===")
    wb = openpyxl.load_workbook(WATSYS_XLSX, read_only=True, data_only=True)
    ws = wb.active

    sys_to_city: dict[str, str] = {}
    sys_to_pop: dict[str, int] = {}
    skipped_no_city = 0

    for row in ws.iter_rows(min_row=2, values_only=True):
        # Columns: SYSTEM_NO, SYSTEM_NAM, HQNAME, ADDRESS, CITY, STATE,
        #          ZIP, ZIP_EXT, POP_SERV, CONNECTION, AREA_SERVE
        system_no = row[0]
        city_raw = row[4]
        pop_raw = row[8]

        if not system_no:
            continue
        sys_id = str(system_no).strip()

        if not city_raw or not str(city_raw).strip():
            skipped_no_city += 1
            continue

        city = str(city_raw).strip().title()

        # Apply name corrections (truncations, abbreviations, exclusions)
        if city in _CITY_CORRECTIONS:
            corrected = _CITY_CORRECTIONS[city]
            if corrected is None:
                # Explicitly excluded (military bases, national parks, artifacts)
                skipped_no_city += 1
                continue
            city = corrected

        sys_to_city[sys_id] = city

        if pop_raw and isinstance(pop_raw, (int, float)) and pop_raw > 0:
            sys_to_pop[sys_id] = int(pop_raw)

    wb.close()

    _log(
        f"  Loaded {len(sys_to_city):,} systems with city "
        f"({skipped_no_city} skipped — no city)."
    )
    return sys_to_city, sys_to_pop


# ---------------------------------------------------------------------------
# Step 3 — Stream SDWIS4.tab and accumulate measurements per system
# ---------------------------------------------------------------------------


def stream_sdwis(
    sys_to_city: dict[str, str],
) -> dict[str, dict[str, list[float]]]:
    """Stream SDWIS4.tab and collect per-system measurements for target analytes.

    Only systems that appear in *sys_to_city* (i.e. have a usable city) are
    retained.  Processing is fully streaming — the 2.2 GB file is never held
    entirely in memory.

    Args:
        sys_to_city: Mapping of system ID to city name (filter).

    Returns:
        Nested dict: {system_id: {param_key: [float, ...]}}
        param_key is one of: hardness, alkalinity, ph, tds, conductivity,
        sodium, chloride.
    """
    _log("=== Step 3: Stream SDWIS4.tab (2.2 GB) ===")

    # We collect lists of validated measurements per system per parameter.
    # param_key mirrors BOUNDS keys; each value is accumulated from multiple
    # possible analyte names.
    sys_data: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    row_count = 0
    kept_count = 0
    skipped_analyte = 0
    skipped_system = 0
    skipped_parse = 0
    skipped_bounds = 0
    skipped_units = 0

    with zipfile.ZipFile(SDWIS_ZIP, "r") as z:
        with z.open("SDWIS4.tab") as raw_f:
            text_f = io.TextIOWrapper(raw_f, encoding="latin-1", errors="replace")
            reader = csv.DictReader(text_f, delimiter="\t")

            for row in reader:
                row_count += 1
                if row_count % 500_000 == 0:
                    _log(
                        f"  {row_count:,} rows | kept {kept_count:,} | "
                        f"skip: analyte={skipped_analyte} sys={skipped_system} "
                        f"parse={skipped_parse} bounds={skipped_bounds} "
                        f"units={skipped_units}"
                    )

                analyte = row.get("Analyte Name", "").strip()
                if analyte not in TARGET_ANALYTES:
                    skipped_analyte += 1
                    continue

                # System identifier: strip 'CA' prefix + whitespace
                wsn_raw = row.get("Water System Number", "")
                sys_id = wsn_raw.strip()
                if sys_id.startswith("CA"):
                    sys_id = sys_id[2:]

                if sys_id not in sys_to_city:
                    skipped_system += 1
                    continue

                # Parse result (handles non-detects)
                result_str = row.get("Result", "")
                less_than = row.get("Less Than Reporting Level", "N")
                rl_str = row.get("Reporting Level", "0")
                val = _parse_result(result_str, less_than, rl_str)
                if val is None:
                    skipped_parse += 1
                    continue

                units = row.get("Units of Measure", "").strip().upper()

                # Route to parameter key with units validation
                param_key: Optional[str] = None

                if analyte == ANALYTE_HARDNESS:
                    if units not in ("MG/L", "MG/L CaCO3".upper(), ""):
                        skipped_units += 1
                        continue
                    if _in_bounds("hardness", val):
                        param_key = "hardness"

                elif analyte in (ANALYTE_ALKALINITY_TOTAL, ANALYTE_ALKALINITY_BICARB):
                    if units not in ("MG/L", "MG/L CaCO3".upper(), ""):
                        skipped_units += 1
                        continue
                    if _in_bounds("alkalinity", val):
                        param_key = "alkalinity"

                elif analyte == ANALYTE_PH_LAB:
                    if _in_bounds("ph", val):
                        param_key = "ph_lab"

                elif analyte == ANALYTE_PH_FIELD:
                    if _in_bounds("ph", val):
                        param_key = "ph_field"

                elif analyte == ANALYTE_TDS:
                    if units not in ("MG/L", ""):
                        skipped_units += 1
                        continue
                    if _in_bounds("tds", val):
                        param_key = "tds"

                elif analyte == ANALYTE_CONDUCTIVITY:
                    if units not in ("UMHO/CM", "UMHOS/CM", "US/CM", ""):
                        skipped_units += 1
                        continue
                    if _in_bounds("conductivity", val):
                        param_key = "conductivity"

                elif analyte == ANALYTE_SODIUM:
                    if units not in ("MG/L", ""):
                        skipped_units += 1
                        continue
                    if _in_bounds("sodium", val):
                        param_key = "sodium"

                elif analyte == ANALYTE_CHLORIDE:
                    if units not in ("MG/L", ""):
                        skipped_units += 1
                        continue
                    if _in_bounds("chloride", val):
                        param_key = "chloride"

                if param_key is None:
                    skipped_bounds += 1
                    continue

                sys_data[sys_id][param_key].append(val)
                kept_count += 1

    _log(
        f"  Done: {row_count:,} rows total | {kept_count:,} measurements kept "
        f"| {len(sys_data):,} systems with data"
    )
    return dict(sys_data)


# ---------------------------------------------------------------------------
# Step 4 — Compute per-system medians
# ---------------------------------------------------------------------------


def compute_system_medians(
    sys_data: dict[str, dict[str, list[float]]],
) -> dict[str, dict[str, Optional[float]]]:
    """Compute median of each parameter per water system.

    pH priority: ph_lab > ph_field (lab measurement preferred).
    TDS priority: tds > conductivity (direct TDS preferred over conductivity
    proxy; conductivity is kept as-is in µS/cm since the existing dataset
    convention for TDS_Conductivity_uS_cm accepts both mg/L and µS/cm).

    Args:
        sys_data: Raw measurement lists per system.

    Returns:
        Dict: {system_id: {param: median_or_None, ...}}
    """
    _log("=== Step 4: Compute per-system medians ===")
    result: dict[str, dict[str, Optional[float]]] = {}

    for sys_id, params in sys_data.items():
        med: dict[str, Optional[float]] = {}

        for param in ("hardness", "alkalinity", "sodium", "chloride", "tds", "conductivity"):
            vals = params.get(param)
            med[param] = round(median(vals), 4) if vals else None

        # pH: lab preferred over field
        ph_lab_vals = params.get("ph_lab")
        ph_field_vals = params.get("ph_field")
        if ph_lab_vals:
            med["ph"] = round(median(ph_lab_vals), 4)
        elif ph_field_vals:
            med["ph"] = round(median(ph_field_vals), 4)
        else:
            med["ph"] = None

        # TDS fallback to conductivity if no direct TDS
        if med["tds"] is None and med["conductivity"] is not None:
            med["tds_source"] = "conductivity"
        else:
            med["tds_source"] = "tds"

        result[sys_id] = med

    _log(f"  {len(result):,} systems with at least one parameter.")
    return result


# ---------------------------------------------------------------------------
# Step 5 — Aggregate to city level
# ---------------------------------------------------------------------------


def aggregate_to_cities(
    sys_medians: dict[str, dict[str, Optional[float]]],
    sys_to_city: dict[str, str],
    sys_to_pop: dict[str, int],
) -> list[dict]:
    """Aggregate system-level medians to city-level entries.

    For each city, compute a population-weighted average of system medians
    when population data is available; otherwise use a simple mean.
    The effective TDS value is taken from direct TDS if available, otherwise
    from conductivity (µS/cm), consistent with the dataset convention.

    Args:
        sys_medians: Per-system median values.
        sys_to_city: System → city mapping.
        sys_to_pop: System → population served.

    Returns:
        List of dicts in the tap-water-db format expected by build_world.py.
    """
    _log("=== Step 5: Aggregate to city level ===")

    # Group systems by city
    city_systems: dict[str, list[str]] = defaultdict(list)
    for sys_id, med in sys_medians.items():
        city = sys_to_city.get(sys_id)
        if not city:
            continue
        city_systems[city].append(sys_id)

    params_of_interest = [
        "hardness",
        "alkalinity",
        "ph",
        "tds",
        "conductivity",
        "sodium",
        "chloride",
    ]

    entries: list[dict] = []
    no_data_cities = 0

    for city, sys_ids in city_systems.items():
        # For each parameter, collect (value, weight) pairs
        param_values: dict[str, list[tuple[float, float]]] = defaultdict(list)

        for sid in sys_ids:
            med = sys_medians.get(sid)
            if med is None:
                continue
            pop = float(sys_to_pop.get(sid, 0))
            weight = pop if pop > 0 else 1.0  # fallback to equal weight

            for param in params_of_interest:
                val = med.get(param)
                if val is not None:
                    param_values[param].append((val, weight))

        if not param_values:
            no_data_cities += 1
            continue

        def _weighted_avg(pairs: list[tuple[float, float]]) -> Optional[float]:
            if not pairs:
                return None
            total_w = sum(w for _, w in pairs)
            if total_w == 0:
                return None
            return sum(v * w for v, w in pairs) / total_w

        hardness = _weighted_avg(param_values.get("hardness", []))
        alkalinity = _weighted_avg(param_values.get("alkalinity", []))
        ph = _weighted_avg(param_values.get("ph", []))
        sodium = _weighted_avg(param_values.get("sodium", []))
        chloride = _weighted_avg(param_values.get("chloride", []))

        # TDS: prefer direct TDS, fall back to conductivity
        tds_val = _weighted_avg(param_values.get("tds", []))
        conductivity_val = _weighted_avg(param_values.get("conductivity", []))
        tds_or_cond = tds_val if tds_val is not None else conductivity_val

        # Unit conversions for build_world.py:
        #   Ca_Hardness_dH  = hardness_mg/L_CaCO3  / 17.848
        #   Alkalinity_TAC_mmol_l = alkalinity_mg/L_CaCO3 / 50.0
        #   pH              = as-is
        #   TDS_Conductivity_uS_cm = TDS mg/L as-is  (or µS/cm from conductivity)
        #   Sodium_Na_mg_l  = as-is
        #   Chlorides_Cl_mg_l = as-is

        def _fmt(val: Optional[float], decimals: int = 4) -> Optional[float]:
            return round(val, decimals) if val is not None else None

        parameters: dict[str, Optional[float]] = {
            "Ca_Hardness_dH": _fmt(hardness / 17.848) if hardness is not None else None,
            "Alkalinity_TAC_mmol_l": _fmt(alkalinity / 50.0) if alkalinity is not None else None,
            "pH": _fmt(ph, 2),
            "TDS_Conductivity_uS_cm": _fmt(tds_or_cond, 1),
            "Sodium_Na_mg_l": _fmt(sodium, 2),
            "Chlorides_Cl_mg_l": _fmt(chloride, 2),
        }

        # Remove None values for cleaner JSON (build_world.py handles missing keys)
        # Actually keep nulls per spec: "Nulls JSON pour les paramètres absents"
        entries.append(
            {
                "Region": f"{city} (USA)",
                "Parameters": parameters,
            }
        )

    _log(
        f"  {len(entries):,} cities with data "
        f"({no_data_cities} cities had no chemistry measurements)."
    )
    return entries


# ---------------------------------------------------------------------------
# Step 6 — Write output JSON
# ---------------------------------------------------------------------------


def write_output(entries: list[dict]) -> None:
    """Write the final JSON to the world data directory.

    Args:
        entries: List of Region/Parameters dicts.
    """
    os.makedirs(WORLD_DIR, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, separators=(",", ":"), indent=None)
    _log(f"  Written: {OUTPUT_FILE} ({os.path.getsize(OUTPUT_FILE):,} bytes)")


# ---------------------------------------------------------------------------
# Step 7 — Print summary statistics
# ---------------------------------------------------------------------------


def print_summary(
    entries: list[dict],
    sys_medians: dict[str, dict[str, Optional[float]]],
    sys_to_city: dict[str, str],
) -> None:
    """Print a detailed summary of the pipeline results.

    Args:
        entries: Output city entries.
        sys_medians: Per-system median dict (for completeness stats).
        sys_to_city: System-to-city mapping.
    """
    n_systems = len(sys_medians)
    n_cities = len(entries)

    param_display = [
        ("Ca_Hardness_dH", "Hardness (dH)"),
        ("Alkalinity_TAC_mmol_l", "Alkalinity (mmol/L)"),
        ("pH", "pH"),
        ("TDS_Conductivity_uS_cm", "TDS/Conductivity"),
        ("Sodium_Na_mg_l", "Sodium (mg/L)"),
        ("Chlorides_Cl_mg_l", "Chloride (mg/L)"),
    ]

    _log("")
    _log("=" * 60)
    _log("SUMMARY")
    _log("=" * 60)
    _log(f"Systems with chemistry data : {n_systems:,}")
    _log(f"Cities produced             : {n_cities:,}")
    _log("")
    _log("Parameter completeness (cities with non-null value):")
    for key, label in param_display:
        present = sum(
            1 for e in entries if e["Parameters"].get(key) is not None
        )
        pct = 100 * present / n_cities if n_cities else 0
        _log(f"  {label:<30} {present:>4}/{n_cities}  ({pct:.0f}%)")

    _log("")
    _log("Sample cities (first 5 with most parameters):")
    scored = sorted(
        entries,
        key=lambda e: sum(1 for v in e["Parameters"].values() if v is not None),
        reverse=True,
    )
    for e in scored[:5]:
        city = e["Region"]
        p = e["Parameters"]
        _log(f"  {city}")
        for key, label in param_display:
            v = p.get(key)
            _log(f"    {label}: {v}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    """Run the full California water quality import pipeline."""
    _log("build_california.py — California EDT/SDWIS water quality importer")
    _log("")

    download_sources()
    sys_to_city, sys_to_pop = load_watsys()
    sys_data = stream_sdwis(sys_to_city)
    sys_medians = compute_system_medians(sys_data)
    entries = aggregate_to_cities(sys_medians, sys_to_city, sys_to_pop)
    write_output(entries)
    print_summary(entries, sys_medians, sys_to_city)


if __name__ == "__main__":
    main()
