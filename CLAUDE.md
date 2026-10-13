# Openings SG

A free web app that shows unemployed people in Singapore where the jobs are and what they pay, using postings scraped from MyCareersFuture (MCF). Built by an engineer who is job hunting too.

**Tagline (use it, don't rewrite it):** "For the unemployed, by an unemployed."

## Audience and tone

- Users are job seekers, often stressed and short on money. Write plainly and kindly. No jargon, no hype, no sign-up walls, no ads.
- Copy speaks in first person from the founder on the About page; everywhere else it speaks to "you".
- Name things the way job seekers do: "openings", "pay", "roles", "companies hiring".

## Current state (MVP)

| Part | What it is today |
|---|---|
| Front end | `web/index.html`: one self-contained HTML file, vanilla JS, hand-drawn SVG charts, no build step, no libraries |
| Data | `scraper/mcf_scraper.py` writes `openings.json`; users load it with the "Load scraped data" button. Without it, the page generates a seeded **sample** dataset |
| Back end | None |
| Database | None |
| Official stats | U-6 style chart uses figures hard-coded in `LABOUR` inside `index.html` |

**New stack (built, not yet deployed):** the roadmap stack now exists alongside the MVP and has only been tested offline against fakes, never against a real Supabase project or on Vercel.

| Part | What it is |
|---|---|
| Database | `db/schema.sql`: Supabase Postgres. `jobs` table plus ten `stats_*` materialised views; `refresh_stats()` rebuilds them. The public (anon) key can read the views only |
| Scraper | `mcf_scraper.py --all --supabase --details N` upserts to `jobs` over Supabase's REST API (still standard library only) and fills vacancy counts from `GET /v2/jobs/{uuid}` |
| Schedule | `.github/workflows/scrape.yml`: daily at 03:17 SGT. Secrets `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Back end | `backend/main.py`: FastAPI on Vercel (root directory `backend`), reads the `stats_*` views. Env `SUPABASE_URL`, `SUPABASE_ANON_KEY`. See `backend/README.md` |
| Front end | `frontend/`: Next.js on Vercel (root directory `frontend`), hand-drawn SVG charts, no sample data. Env `API_URL`, `NEXT_PUBLIC_SITE_URL` |

The view names and columns in `db/schema.sql`, the `/v1/*` shapes in `backend/main.py` and the types in `frontend/lib/types.ts` are one contract; change them together. Slugs come from the scraper (`slugify()`); nothing else recomputes them.

Originally built as a Claude.ai artifact. That's why everything lives in one file and why it avoids external requests. Those limits no longer apply locally, but keep the page working as a single static file until the planned stack replaces it.

## Run it

```bash
# front end (any static server)
python3 -m http.server 8000 -d web        # open http://localhost:8000

# scraper (Python 3.9+, standard library only)
python3 scraper/mcf_scraper.py --all --out data/openings.json   # every live job, all categories
python3 scraper/mcf_scraper.py --category "Information Technology" --out data/openings.json
```

Then click **Load scraped data** in the app and pick `data/openings.json`.

## File map

```
web/index.html          the whole app (styles, markup, script)
scraper/mcf_scraper.py  MCF scraper; JSON-file mode (merges, dedupes by job id) and --supabase mode
data/                   scraped output (git-ignored)
db/schema.sql           Supabase schema, stats views and functions (re-runnable)
backend/                FastAPI service + pytest suite
frontend/               Next.js site (app/, components/, lib/)
.github/workflows/      daily scrape
CLAUDE.md               this file
README.md               short human-facing intro
```

## How `web/index.html` is organised

Search for these markers / names:

- **Design tokens**: the `:root` block at the top of `<style>`. Marina dusk palette, dark-first. Light theme lives under `@media (prefers-color-scheme: light)` *and* `:root[data-theme="light"]`; keep both in sync.
- **Pages** are `<main class="view">` elements toggled by the URL hash in `route()`:
  `#overview`, `#season`, `#sectors`, `#sector` (deep dive for `state.selected`), `#about`.
  Aliases: `#kopi`, `#coffee`, `#business` → About (scrolls to that card), `#dashboard` → Overview.
  Hashes must stay bare tokens (no `#key=value`).
- **`state`**: `data`, `source`, `trendSector`, `sort`, `query`, `selected`, `openRole`, `allRoles`, `allCos`.
- **`makeSample()`**: seeded sample generator (sectors, roles, seasonality, invented company names). Sample data must always be labelled as sample in the UI.
- **`fromRaw()`**: maps a scraped record (or a raw MCF API object) into the internal record. Add new fields here first.
- **`roleOf()`**: normalises job titles into role names (strips "Senior", "(Contract)", etc.).
- **`aggregate()`**: builds per-sector and per-role stats (median, mean, P25, P75, openings, postings, employment type, seniority).
- **`buckets()`**: time buckets for trends; switches to weekly when data spans < 90 days.
- **Render functions**: `renderKPIs`, `renderOverview`, `renderTrend`, `renderLabour`, `renderSectors`, `renderDetail`, `offersList` (companies per role), `renderCoffee`.
- **`LABOUR`**: official MOM figures `[year, resident unemployment % (SA, end-June), time-related underemployment %]`.
- **`SUPPORT`**: `bmcUsername`, `paynow`, `businessEmail`. Empty values show a "coming soon" state.

## Data model

Record shape (scraper output and internal):

```json
{
  "id": "mcf uuid",
  "title": "Senior Data Analyst",
  "company": "Example Pte Ltd",
  "sector": "Information Technology",
  "salary_min": 5000, "salary_max": 7000,
  "vacancies": 2,
  "posted_date": "2026-09-14",
  "employment_type": "Full Time",
  "seniority": "Executive",
  "url": "https://www.mycareersfuture.gov.sg/job/...",
  "first_seen": "2026-09-15", "last_seen": "2026-10-13"
}
```

Rules the numbers follow:
- Salaries are **monthly SGD**. Annual is divided by 12; hourly/daily is dropped.
- A posting's pay = **midpoint** of its advertised range. Stats use midpoints.
- **Openings = vacancies**, so one posting can count several times. **Postings = listings**.
- Sector = the first MCF category on the job.
- `first_seen` / `last_seen` let you compute days listed once the scraper runs daily.

## Data honesty (non-negotiable)

- Never present sample or invented figures as real. Sample data stays labelled.
- Official statistics need a source link next to them. Don't fill gaps with estimates; leave them out and say so.
- The U-6 style chart is unemployment + time-related underemployment. Singapore has no official U-6. Keep that caveat visible.
- Salaries shown are *advertised* pay, not what people are finally paid.

## Design rules

- Glassmorphism over a Marina Bay dusk sky. Colours always come from tokens (`--accent` sunset orange, `--coral` rose, `--sky` dusk blue, etc.), never literal hex in components.
- Font: Apple's SF via the system stack (`-apple-system, BlinkMacSystemFont, ...`). Don't add web fonts.
- Must work at 380px wide with no horizontal page scroll; tables scroll inside their own wrapper.
- Respect `prefers-reduced-motion`. Keep visible keyboard focus.
- Don't put `alert/confirm/prompt` in the UI; show messages inline.

## Scraper notes

- Uses MCF's public search API (`POST /v2/search`), falling back to `GET /v2/jobs`. Verified against the live API on 2026-10-13: all 43 categories valid, about 70k live jobs, about 724 requests per `--all` run.
- MCF limits: `limit` max 100, and only the first 10,000 results of any query are reachable. `--all` crawls category by category to stay under that; the largest category was 7,455. The run exits 1 if a category is empty or stops early.
- Search results carry **no vacancy count**; only `GET /v2/jobs/{uuid}` does. In the database `vacancies` is NULL until `--details` fetches it, such postings count as one opening, and `stats_meta.vacancy_coverage` says how many are known. JSON-file mode still writes 1.
- `posted_date` is MCF's `newPostingDate`, which can be a repost date.
- Pay under S$300 a month (about 2% of postings, e.g. 1-1) is treated as missing in the database's pay stats.
- Keep `--delay` ≥ 1s. Check MCF's terms of use before scaling up.

## Open TODOs

- [ ] Fill `SUPPORT` (Buy Me a Coffee username, PayNow number/UEN, business email).
- [ ] Personalise the About story with the founder's real experience.
- [x] Verify the scraper against the live MCF API.
- [ ] Deploy the new stack: run `db/schema.sql` in Supabase, set the GitHub secrets, deploy `backend/` then `frontend/` to Vercel.
- [ ] Decide a retention plan for the 500 MB Supabase free tier (roughly 3 months at current volume; `--prune-raw 30` extends it).
- [ ] Check MCF's terms of use for the daily crawl and the `--details` lookups.
- [ ] Founder to review the About copy changed in `frontend/app/about`.
- [ ] Add 2026 time-related underemployment to `LABOUR` when MOM publishes it (usually late November).
- [ ] Optionally add discouraged workers to the U-6 measure if a consistent MOM series is found.

## Roadmap (agreed direction)

1. **Database:** PostgreSQL on Supabase or Neon. Tables: `jobs` (clean columns + raw `jsonb`, `first_seen`, `last_seen`), plus views or materialised views for sector stats, role stats, company offers and monthly trends (`percentile_cont` for medians).
2. **Scheduling:** GitHub Actions cron runs `mcf_scraper.py --all` daily and upserts into Postgres.
3. **Back end:** FastAPI (Python, same as the scraper) serving pre-aggregated JSON. Lean option: skip it and read Supabase views directly.
4. **Front end:** Next.js on Vercel, with a static page per sector and per role (for search traffic such as "data analyst salary Singapore"). Port the current tokens and layout; ECharts or Recharts for charts.

When migrating, keep the current page working until the new front end reaches feature parity.

## Working agreements for Claude

- Prefer small, focused edits; don't reformat the whole file.
- After editing `web/index.html`, check the script still parses (e.g. extract the `<script>` and run `node --check`).
- Ask before adding dependencies, a build step, or any service that costs money.
- Don't invent statistics, company names presented as real, or user testimonials.
