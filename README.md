# Openings SG

*For the unemployed, by an unemployed.*

See where Singapore is hiring and what it pays: openings and salaries by sector, role and company from MyCareersFuture, hiring-season trends, and a U-6 style underutilisation chart from official MOM data.

## Quick start

```bash
python3 -m http.server 8000 -d web
# open http://localhost:8000
```

The app opens with clearly labelled sample data. To use real listings:

```bash
python3 scraper/mcf_scraper.py --all --out data/openings.json
```

Then click **Load scraped data** and choose `data/openings.json`. Run the scraper daily to build hiring-season history.

See `CLAUDE.md` for architecture, data rules and the roadmap.
