"""
Extract Vermont Population Projection tables from PDF into CSV files.

Run from the scripts/ directory:
    python extract_data.py

Outputs 4 CSV files to the project root:
    ../county_projections_a.csv
    ../county_projections_b.csv
    ../town_projections_a.csv
    ../town_projections_b.csv
"""

import csv
import os
import re
import sys

import pdfplumber

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.join(SCRIPT_DIR, "..")
PDF_PATH   = os.path.join(ROOT_DIR, "data", "ACCD-DED-VTPopulationProjections-2010-2030.pdf")

# ---------------------------------------------------------------------------
# PDF page index ranges (0-based)
# ---------------------------------------------------------------------------
COUNTY_A_PAGES = range(5, 20)   # pages 6-20:  index 5 = VT Total, 6-19 = 14 counties
COUNTY_B_PAGES = range(20, 35)  # pages 21-35: index 20 = VT Total, 21-34 = 14 counties
TOWN_A_PAGES   = range(35, 48)  # pages 36-48
TOWN_B_PAGES   = range(48, 61)  # pages 49-61

# ---------------------------------------------------------------------------
# Name normalization: PDF spelling -> GeoJSON TOWNNAME spelling
# ---------------------------------------------------------------------------
TOWN_NAME_MAP = {
    "ST. ALBANS CITY": "SAINT ALBANS CITY",
    "ST. ALBANS TOWN": "SAINT ALBANS TOWN",
    "ST. GEORGE":      "SAINT GEORGE",
    "ST. JOHNSBURY":   "SAINT JOHNSBURY",
    "ENOSBURG":        "ENOSBURGH",
    "ENOSBURG FALLS":  "ENOSBURGH FALLS",
    "BUEL'S GORE":     "BUELS GORE",
    "WARNER'S GRANT":  "WARNERS GRANT",
    "WARREN'S GORE":   "WARRENS GORE",
}

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
# Matches a county age-cohort data row, e.g.:
#   <5 31,952 30,854 -3.4% 30,065 -5.9%
#   Total 625,741 653,575 4.4% 670,073 7.1%
COUNTY_ROW_RE = re.compile(
    r'^(<5|5-9|10-14|15-19|20-24|25-29|30-34|35-39|40-44|45-49|'
    r'50-54|55-59|60-64|65-69|70-74|75-79|80-84|85\+|Total)\s+'
    r'([\d,]+)\s+'
    r'([\d,]+)\s+'
    r'(-?[\d.]+)%\s+'
    r'([\d,]+)\s+'
    r'(-?[\d.]+)%'
)

# Matches a town data row, e.g.:
#   ADDISON 1,371 1,444 5.3% 1,459 6.4%
# Town name may contain spaces, apostrophes, periods, hyphens
TOWN_ROW_RE = re.compile(
    r'^([A-Z][A-Z0-9\'\.\- ]+?)\s+'
    r'([\d,]+)\s+'
    r'([\d,]+)\s+'
    r'(-?[\d.]+)%\s+'
    r'([\d,]+)\s+'
    r'(-?[\d.]+)%\s*$'
)

# Matches a county heading on a town page, e.g. "Addison County"
COUNTY_HEADING_RE = re.compile(r'^([A-Z][a-z]+(?: [A-Z][a-z]+)*) County$')

# Matches rows to skip on town pages
SKIP_RE = re.compile(r'^(County Total|Vermont Total)', re.IGNORECASE)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clean_int(s):
    return int(s.replace(",", ""))

def clean_float(s):
    return float(s)

def normalize_county(raw):
    """'Addison County' -> 'ADDISON';  'Vermont Total' -> 'VERMONT'"""
    raw = raw.strip()
    if raw == "Vermont Total":
        return "VERMONT"
    return raw.replace(" County", "").upper()

def normalize_town(raw):
    raw = raw.strip().upper()
    return TOWN_NAME_MAP.get(raw, raw)


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------
def parse_county_page(text):
    """Return (county_name_str, list_of_row_dicts) from one county page."""
    lines = [l for l in text.splitlines() if l.strip()]

    # Find the county/entity name line: comes after the 3 header lines.
    # Header lines contain known keywords; entity name is next non-header line.
    entity_name = None
    data_rows = []

    header_keywords = {
        "Vermont Population Projections",
        "%change from",
        "Ages",
        "2010 Census",
    }

    past_headers = False
    for line in lines:
        # Skip header lines
        if any(kw in line for kw in header_keywords):
            continue

        if not past_headers:
            # First non-header line is the entity name
            # It could be "Vermont Total", "Addison County", etc.
            if re.match(r'^[A-Z][a-zA-Z]', line):
                entity_name = normalize_county(line.strip())
                past_headers = True
            continue

        m = COUNTY_ROW_RE.match(line.strip())
        if m:
            data_rows.append({
                "county":          entity_name,
                "age_group":       m.group(1),
                "census_2010":     clean_int(m.group(2)),
                "proj_2020":       clean_int(m.group(3)),
                "pct_change_2020": clean_float(m.group(4)),
                "proj_2030":       clean_int(m.group(5)),
                "pct_change_2030": clean_float(m.group(6)),
            })

    return entity_name, data_rows


def parse_town_page(text):
    """Return list_of_row_dicts from one town page (may span multiple counties)."""
    lines = [l for l in text.splitlines() if l.strip()]
    rows = []
    current_county = None

    header_keywords = {
        "Vermont 2010 Census",
        "%change",
        "Town",
        "2010",
        "Census",
        "from 2010",
    }

    past_headers = False

    for line in lines:
        line = line.strip()

        # Skip header lines (first 3-4 lines of each page)
        if not past_headers:
            if any(kw in line for kw in header_keywords):
                continue
            # The first non-header line is either a county heading or a data row
            past_headers = True

        # Skip "County Total" lines
        if SKIP_RE.match(line):
            continue

        # Check for county heading: "Addison County", "Grand Isle County", etc.
        m_county = COUNTY_HEADING_RE.match(line)
        if m_county:
            current_county = m_county.group(0).replace(" County", "").upper()
            continue

        # Try to match a town data row
        m = TOWN_ROW_RE.match(line)
        if m and current_county:
            town_raw = m.group(1).strip()
            # Skip if looks like a header remnant
            if town_raw in ("Town", "Census"):
                continue
            rows.append({
                "county":          current_county,
                "town":            normalize_town(town_raw),
                "census_2010":     clean_int(m.group(2)),
                "proj_2020":       clean_int(m.group(3)),
                "pct_change_2020": clean_float(m.group(4)),
                "proj_2030":       clean_int(m.group(5)),
                "pct_change_2030": clean_float(m.group(6)),
            })

    return rows


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------
COUNTY_FIELDS = ["county", "age_group", "census_2010", "proj_2020",
                 "pct_change_2020", "proj_2030", "pct_change_2030"]
TOWN_FIELDS   = ["county", "town", "census_2010", "proj_2020",
                 "pct_change_2020", "proj_2030", "pct_change_2030"]

def write_csv(rows, fields, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Wrote {len(rows):4d} rows -> {os.path.basename(path)}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print(f"Opening: {PDF_PATH}")
    county_a_rows = []
    county_b_rows = []
    town_a_rows   = []
    town_b_rows   = []

    with pdfplumber.open(PDF_PATH) as pdf:
        total = len(pdf.pages)
        print(f"Total pages: {total}\n")

        # County Scenario A
        print("Parsing county pages - Scenario A...")
        for idx in COUNTY_A_PAGES:
            text = pdf.pages[idx].extract_text() or ""
            _, rows = parse_county_page(text)
            county_a_rows.extend(rows)

        # County Scenario B
        print("Parsing county pages - Scenario B...")
        for idx in COUNTY_B_PAGES:
            text = pdf.pages[idx].extract_text() or ""
            _, rows = parse_county_page(text)
            county_b_rows.extend(rows)

        # Town Scenario A
        print("Parsing town pages - Scenario A...")
        for idx in TOWN_A_PAGES:
            text = pdf.pages[idx].extract_text() or ""
            rows = parse_town_page(text)
            town_a_rows.extend(rows)

        # Town Scenario B
        print("Parsing town pages - Scenario B...")
        for idx in TOWN_B_PAGES:
            text = pdf.pages[idx].extract_text() or ""
            rows = parse_town_page(text)
            town_b_rows.extend(rows)

    print("\nWriting CSVs...")
    write_csv(county_a_rows, COUNTY_FIELDS, os.path.join(ROOT_DIR, "data", "county_projections_a.csv"))
    write_csv(county_b_rows, COUNTY_FIELDS, os.path.join(ROOT_DIR, "data", "county_projections_b.csv"))
    write_csv(town_a_rows,   TOWN_FIELDS,   os.path.join(ROOT_DIR, "data", "town_projections_a.csv"))
    write_csv(town_b_rows,   TOWN_FIELDS,   os.path.join(ROOT_DIR, "data", "town_projections_b.csv"))

    print("\nDone.")

    # Quick validation
    print("\n--- Validation ---")
    counties_a = set(r["county"] for r in county_a_rows if r["county"] != "VERMONT")
    counties_b = set(r["county"] for r in county_b_rows if r["county"] != "VERMONT")
    towns_a    = set(r["town"] for r in town_a_rows)
    towns_b    = set(r["town"] for r in town_b_rows)
    print(f"Counties in A: {len(counties_a)}  B: {len(counties_b)}")
    print(f"Towns in A:    {len(towns_a)}  B: {len(towns_b)}")
    if counties_a != counties_b:
        print(f"  County mismatch A-B: {counties_a ^ counties_b}")
    if towns_a != towns_b:
        print(f"  Town mismatch A-B: {towns_a ^ towns_b}")


if __name__ == "__main__":
    main()
