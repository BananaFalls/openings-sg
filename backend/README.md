# Openings SG back end

A small read-only FastAPI app. It serves the pre-aggregated `stats_*` materialised
views from Supabase as JSON. It never reads the `jobs` table and never computes or
fills in numbers: values are passed through from the views, and nulls stay null.

Everything lives in `main.py`.

## Endpoints

All `GET`, all JSON. Pay is monthly SGD from advertised ranges.

| Path | Returns |
|---|---|
| `/healthz` | `{ok: true}` (does not call Supabase) |
| `/v1/meta` | totals, scrape dates, coverage |
| `/v1/sectors` | every sector, most openings first |
| `/v1/sectors/{slug}` | one sector with employment types, seniority, pay histogram, top 200 roles |
| `/v1/roles?min_postings=5&limit=100&offset=0&q=` | roles, most openings first; `q` is a case-insensitive substring of the role name; `limit` max 1000 |
| `/v1/roles/{slug}` | one role with sectors, employment types, seniority, top 50 companies hiring |
| `/v1/trends?sector={slug}` | weekly points when the data spans under 90 days, else monthly; no `sector` means all sectors |

Interactive docs are at `/docs` when the app is running.

Errors: unknown slug is `404 {detail}`; bad query parameter is `422 {detail}`;
Supabase unreachable or misconfigured is `503 {detail}` (details go to the server
log only). Data responses carry
`Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`; errors are
`no-store`. Any origin may `GET`.

## Environment variables

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL, e.g. `https://abcdefghijklmnop.supabase.co` |
| `SUPABASE_ANON_KEY` | The project's anon (public) key. Do not use the `service_role` key. |

The anon role needs `SELECT` on the `stats_*` views and nothing else.

## Run locally

Python 3.12 or newer. Keep the virtualenv outside OneDrive-synced folders.

```bash
python -m venv ~/.venvs/openings-backend
source ~/.venvs/openings-backend/bin/activate      # Windows: ~\.venvs\openings-backend\Scripts\Activate.ps1
pip install -r requirements-dev.txt

export SUPABASE_URL=https://YOUR-PROJECT.supabase.co   # PowerShell: $env:SUPABASE_URL = "..."
export SUPABASE_ANON_KEY=YOUR-ANON-KEY
uvicorn main:app --reload --port 8000

curl http://localhost:8000/healthz
curl http://localhost:8000/v1/meta
```

## Tests

```bash
pytest
```

The tests stub Supabase with an in-memory PostgREST stand-in (`tests/conftest.py`),
so they need no network and no keys.

## Deploy to Vercel

This folder is its own Vercel project. Vercel detects FastAPI from
`requirements.txt` and loads the `app` object in `main.py`; no `vercel.json` is
needed. `.python-version` selects Python 3.14, and `.vercelignore` keeps tests out
of the deployment.

From the dashboard (Git):

1. New Project, import the repository.
2. Set **Root Directory** to `backend`. Leave the framework preset (FastAPI) and
   build settings at their defaults.
3. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` under Environment Variables
   (Production and Preview).
4. Deploy, then open `/healthz` and `/v1/meta`.

From the CLI (needs Vercel CLI 48.1.8 or newer):

```bash
cd backend
vercel link
vercel env add SUPABASE_URL production
vercel env add SUPABASE_ANON_KEY production
vercel deploy --prod
```

Give the deployment URL to the front end as its API base URL.
