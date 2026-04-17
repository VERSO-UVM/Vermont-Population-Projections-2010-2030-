# Vermont Population Projections 2010–2030

An interactive static data visualization site for Vermont population projections, based on data published in August 2013 by the Vermont Agency of Commerce and Community Development (ACCD). This has projections for 2020 and 2030, and it is useful to note that we can say after the fact they were not vary accurate due to unexpected events like COVID and other economic factors. This is expected when trying to do projections on population as it is very hard to predict such a complicated system. 

**Live site:** https://verso-uvm.github.io/Vermont-Population-Projections-2010-2030-/

## Features

- **About** — Methodology, scenario descriptions, projection formula, and caveats from the original report
- **County Age-Cohort Map** — Choropleth of Vermont's 14 counties shaded by total population % change from 2010. Click any county to see a 100% stacked area chart of age-cohort distribution across 2010, 2020, and 2030, plus a data table. Toggle between Scenario A/B and projection year.
- **Town Map** — Choropleth of all 255 Vermont towns shaded by population % change. Click any town for a popup showing 2010 Census count, 2020 and 2030 projections, and % change. Toggle between Scenario A/B and projection year.

## Data

| File | Description |
|---|---|
| `data/ACCD-DED-VTPopulationProjections-2010-2030.pdf` | Original source report |
| `data/county_projections_a.csv` | County age-cohort projections, Scenario A |
| `data/county_projections_b.csv` | County age-cohort projections, Scenario B |
| `data/town_projections_a.csv` | Town-level projections, Scenario A |
| `data/town_projections_b.csv` | Town-level projections, Scenario B |
| `data/FS_VCGI_OPENDATA_Boundary_BNDHASH_poly_counties_SP_v1_*.geojson` | Vermont county boundaries (VCGI) |
| `data/FS_VCGI_OPENDATA_Boundary_BNDHASH_poly_towns_SP_v1_*.geojson` | Vermont town boundaries (VCGI) |

### Scenarios

- **Scenario A** — Uses 1990s migration rates (higher in-migration); projects higher growth or slower decline
- **Scenario B** — Uses 2000s migration rates (lower in-migration); projects lower growth or greater population loss

## Regenerating the CSV Data

Requires Python 3 with `pdfplumber` installed:

```bash
pip install pdfplumber
cd scripts
python extract_data.py
```

## Running Locally

No build step required. Serve the project root with any static file server:

```bash
python -m http.server 8080
# then open http://localhost:8080
```

## Deployment

The site deploys automatically to GitHub Pages on every push to `main` via the workflow at `.github/workflows/deploy.yml`. To enable it:

1. Go to **Settings → Pages** in this repository
2. Under **Source**, select **GitHub Actions**
3. Save — subsequent pushes to `main` will deploy automatically

## Tech Stack

- [Leaflet.js](https://leafletjs.com/) — interactive maps
- [Chart.js](https://www.chartjs.org/) — age-cohort area chart
- [PapaParse](https://www.papaparse.com/) — CSV parsing
- [chroma.js](https://gka.github.io/chroma.js/) — choropleth color scales
- No build step — pure HTML, CSS, and JavaScript

## Source

Vermont Population Projections 2010–2030, prepared by Ken Jones, Ph.D., Vermont Agency of Commerce and Community Development, August 2013. Geographic boundaries from the Vermont Center for Geographic Information (VCGI).

## License

MIT — Copyright 2026 VERSO
