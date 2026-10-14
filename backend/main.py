"""Openings SG API.

A thin, read-only layer over the pre-aggregated `stats_*` materialised views in
Supabase (read through PostgREST). It never touches the `jobs` table and never
computes or fills in numbers: values come straight from the views, and nulls
stay null.

Vercel loads the `app` object in this file (see README.md).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import date
from typing import Annotated, Any, AsyncIterator

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

log = logging.getLogger("openings_sg")

CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400"
SLUG_RE = re.compile(r"^[a-z0-9-]{1,120}$")
PAGE_SIZE = 1000  # PostgREST's default row cap; the server may enforce less
MAX_PAGES = 200  # safety stop for the paging loop
TIMEOUT = httpx.Timeout(10.0, connect=5.0)
UNAVAILABLE = "The data source is unavailable right now. Please try again later."

# Tests replace this with an httpx.MockTransport. None = real network.
TRANSPORT: httpx.AsyncBaseTransport | None = None

Row = dict[str, Any]


class UpstreamError(Exception):
    """Supabase is unreachable, misconfigured, or answered unexpectedly."""


# ---------------------------------------------------------------- Supabase


class Supabase:
    """Minimal PostgREST reader. Only ever issues GETs against views."""

    def __init__(self, client: httpx.AsyncClient):
        self._client = client

    async def select(
        self,
        view: str,
        columns: str,
        filters: dict[str, str] | None = None,
        *,
        order: str,
        offset: int = 0,
        limit: int | None = None,
    ) -> tuple[list[Row], int | None]:
        """Return (rows, total matching rows).

        Pages through the server's row cap. `order` must end in a unique key so
        pages do not overlap. `total` is None only if the server did not say.
        Filter values must already be validated by the caller; httpx
        URL-encodes them, so they cannot add or alter query parameters.
        """
        rows: list[Row] = []
        total: int | None = None
        for _ in range(MAX_PAGES):
            want = PAGE_SIZE if limit is None else min(PAGE_SIZE, limit - len(rows))
            if want <= 0:
                break
            params = {
                "select": columns,
                **(filters or {}),
                "order": order,
                "limit": str(want),
                "offset": str(offset + len(rows)),
            }
            try:
                resp = await self._client.get(
                    f"/{view}", params=params, headers={"Prefer": "count=exact"}
                )
            except httpx.HTTPError as exc:
                log.error("supabase request failed: %s (%s)", view, type(exc).__name__)
                raise UpstreamError() from None

            total = _total_from(resp.headers.get("content-range"), total)
            if resp.status_code == 416:  # offset is past the last row
                break
            if resp.status_code not in (200, 206):
                log.error("supabase answered %s for %s", resp.status_code, view)
                raise UpstreamError()
            try:
                page = resp.json()
            except ValueError:
                log.error("supabase sent a non-JSON body for %s", view)
                raise UpstreamError() from None
            if not isinstance(page, list) or not all(isinstance(r, dict) for r in page):
                log.error("supabase sent an unexpected body shape for %s", view)
                raise UpstreamError()

            rows.extend(page)
            if not page:
                break
            if total is not None and offset + len(rows) >= total:
                break
        else:
            log.error("paging did not finish for %s", view)
            raise UpstreamError()
        return rows, total


def _total_from(content_range: str | None, fallback: int | None) -> int | None:
    """Parse the total out of `0-999/3573` or `*/3573`."""
    if content_range and "/" in content_range:
        tail = content_range.rsplit("/", 1)[1]
        if tail.isdigit():
            return int(tail)
    return fallback


async def supabase() -> AsyncIterator[Supabase]:
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not key or not re.match(r"^https?://[^\s/]+", url):
        log.error("SUPABASE_URL / SUPABASE_ANON_KEY are missing or malformed")
        raise UpstreamError()
    async with httpx.AsyncClient(
        base_url=f"{url}/rest/v1",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"},
        timeout=TIMEOUT,
        transport=TRANSPORT,
    ) as client:
        yield Supabase(client)


Db = Annotated[Supabase, Depends(supabase)]

# ------------------------------------------------------------------- shapes

PAY_COLS = "pay_p25,pay_median,pay_p75,pay_mean,pay_n"
SECTOR_COLS = f"sector,sector_slug,postings,companies,{PAY_COLS}"
ROLE_COLS = f"role_slug,role,postings,companies,top_sector,top_sector_slug,{PAY_COLS}"
SECTOR_ROLE_COLS = f"role_slug,role,postings,{PAY_COLS}"
SECTOR_EXP_COLS = f"level,years_from,years_to,postings,{PAY_COLS}"
SECTOR_EXP_ROLE_COLS = f"years_from,role_slug,role,postings,{PAY_COLS}"
EXP_ROLE_ROWS = 600  # roles fetched per sector across its levels, most postings first


def pay(r: Row) -> dict[str, Any]:
    return {
        "p25": r.get("pay_p25"),
        "median": r.get("pay_median"),
        "p75": r.get("pay_p75"),
        "mean": r.get("pay_mean"),
        "n": r.get("pay_n"),
    }


def sector_summary(r: Row) -> dict[str, Any]:
    return {
        "sector": r.get("sector"),
        "slug": r.get("sector_slug"),
        "postings": r.get("postings"),
        "companies": r.get("companies"),
        "pay": pay(r),
    }


def role_summary(r: Row) -> dict[str, Any]:
    return {
        "role": r.get("role"),
        "slug": r.get("role_slug"),
        "postings": r.get("postings"),
        "companies": r.get("companies"),
        "top_sector": r.get("top_sector"),
        "top_sector_slug": r.get("top_sector_slug"),
        "pay": pay(r),
    }


def dims(rows: list[Row], dim: str) -> list[dict[str, Any]]:
    return [
        {"name": r.get("name"), "postings": r.get("postings")}
        for r in rows
        if r.get("dim") == dim
    ]


def check_slug(slug: str, what: str) -> str:
    """A slug that does not match the pattern cannot exist, so it is a 404."""
    if not SLUG_RE.fullmatch(slug):
        raise HTTPException(status_code=404, detail=f"{what} not found")
    return slug


def ilike_contains(q: str) -> str:
    """PostgREST `ilike` value for a literal, case-insensitive substring match.

    LIKE's own wildcards (% and _) and its escape character are escaped.
    PostgREST treats `*` as an alias for `%` and has no way to escape it, so a
    literal `*` becomes `_` (matches any one character, including `*`).
    """
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"ilike.*{escaped.replace('*', '_')}*"


# ---------------------------------------------------------------------- app

app = FastAPI(
    title="Openings SG API",
    description="Pre-aggregated job postings and advertised pay in Singapore. "
    "Pay is monthly SGD, taken from advertised ranges.",
    version="1.0.0",
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], max_age=86400)


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    # Set unconditionally (CORSMiddleware only adds it when the request has an
    # Origin header, and the CDN may cache a response to a request without one).
    response.headers["Access-Control-Allow-Origin"] = "*"
    cacheable = response.status_code == 200 and request.url.path.startswith("/v1/")
    response.headers["Cache-Control"] = CACHE_CONTROL if cacheable else "no-store"
    return response


@app.exception_handler(UpstreamError)
async def upstream_error(request: Request, exc: UpstreamError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": UNAVAILABLE})


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.get("/v1/meta")
async def meta(db: Db) -> dict[str, Any]:
    rows, _ = await db.select(
        "stats_meta",
        "last_scrape,first_scrape,postings,companies,pay_median,pay_coverage",
        order="last_scrape.desc.nullslast",
        limit=1,
    )
    if not rows:  # no scrape yet: counts are truly zero, everything else unknown
        return {
            "last_scrape": None,
            "first_scrape": None,
            "postings": 0,
            "companies": 0,
            "median_pay": None,
            "pay_coverage": None,
        }
    r = rows[0]
    return {
        "last_scrape": r.get("last_scrape"),
        "first_scrape": r.get("first_scrape"),
        "postings": r.get("postings"),
        "companies": r.get("companies"),
        "median_pay": r.get("pay_median"),
        "pay_coverage": r.get("pay_coverage"),
    }


@app.get("/v1/sectors")
async def sectors(db: Db) -> dict[str, Any]:
    rows, _ = await db.select(
        "stats_sector",
        SECTOR_COLS,
        order="postings.desc.nullslast,sector_slug.asc",
    )
    return {"sectors": [sector_summary(r) for r in rows]}


@app.get("/v1/sectors/{slug}")
async def sector_detail(slug: str, db: Db) -> dict[str, Any]:
    check_slug(slug, "Sector")
    eq = {"sector_slug": f"eq.{slug}"}
    (found, _), (dim_rows, _), (hist, _), (roles, _), (exp, _), (exp_roles, _) = await asyncio.gather(
        db.select("stats_sector", SECTOR_COLS, eq, order="sector_slug.asc", limit=1),
        db.select(
            "stats_sector_dim",
            "dim,name,postings",
            eq,
            order="postings.desc.nullslast,dim.asc,name.asc",
        ),
        db.select(
            "stats_sector_hist",
            "bucket_from,bucket_to,count",
            eq,
            order="bucket_from.asc,bucket_to.asc",
        ),
        db.select(
            "stats_sector_role",
            SECTOR_ROLE_COLS,
            eq,
            order="postings.desc.nullslast,role_slug.asc",
            limit=200,
        ),
        db.select("stats_sector_exp", SECTOR_EXP_COLS, eq, order="years_from.asc"),
        db.select(
            "stats_sector_exp_role",
            SECTOR_EXP_ROLE_COLS,
            eq,
            order="postings.desc.nullslast,years_from.asc,role_slug.asc",
            limit=EXP_ROLE_ROWS,
        ),
    )
    if not found:
        raise HTTPException(status_code=404, detail="Sector not found")
    sector = found[0]
    return {
        **sector_summary(sector),
        "employment_types": dims(dim_rows, "employment_type"),
        "seniority": dims(dim_rows, "seniority"),
        "histogram": [
            {"from": h.get("bucket_from"), "to": h.get("bucket_to"), "count": h.get("count")}
            for h in hist
        ],
        # Pay by the years of experience a posting asks for, with the roles
        # offered at each level. Only postings whose details have been looked up
        # are counted, so `postings` is a sample.
        "experience": [
            {
                "level": e.get("level"),
                "years_from": e.get("years_from"),
                "years_to": e.get("years_to"),  # null = this many years or more
                "postings": e.get("postings"),
                "pay": pay(e),
                "roles": [
                    {
                        "role": r.get("role"),
                        "slug": r.get("role_slug"),
                        "postings": r.get("postings"),
                        "pay": pay(r),
                    }
                    for r in exp_roles
                    if r.get("years_from") == e.get("years_from")
                ],
            }
            for e in exp
        ],
        "roles": [
            role_summary(
                {
                    **r,
                    "companies": None,  # not available per sector and role
                    "top_sector": sector.get("sector"),
                    "top_sector_slug": sector.get("sector_slug"),
                }
            )
            for r in roles
        ],
    }


@app.get("/v1/roles")
async def roles(
    db: Db,
    min_postings: Annotated[int, Query(ge=0, le=1_000_000_000)] = 5,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0, le=1_000_000_000)] = 0,
    q: Annotated[str, Query(max_length=100)] = "",
) -> dict[str, Any]:
    filters = {"postings": f"gte.{min_postings}"}
    # Trim, collapse whitespace and drop control characters.
    needle = " ".join("".join(c for c in q if c.isprintable() or c.isspace()).split())
    if needle:
        filters["role"] = ilike_contains(needle)
    order = "postings.desc.nullslast,role_slug.asc"

    rows, total = await db.select(
        "stats_role", ROLE_COLS, filters, order=order, offset=offset, limit=limit
    )
    if total is None:  # server did not report a count for that page
        _, total = await db.select("stats_role", "role_slug", filters, order=order, limit=1)
    if total is None:
        log.error("supabase did not report a row count for stats_role")
        raise UpstreamError()
    return {"total": total, "roles": [role_summary(r) for r in rows]}


@app.get("/v1/roles/{slug}")
async def role_detail(slug: str, db: Db) -> dict[str, Any]:
    check_slug(slug, "Role")
    eq = {"role_slug": f"eq.{slug}"}
    (found, _), (sector_rows, _), (dim_rows, _), (companies, _) = await asyncio.gather(
        db.select("stats_role", ROLE_COLS, eq, order="role_slug.asc", limit=1),
        db.select(
            "stats_role_sector",
            "sector,sector_slug,postings",
            eq,
            order="postings.desc.nullslast,sector_slug.asc",
        ),
        db.select(
            "stats_role_dim",
            "dim,name,postings",
            eq,
            order="postings.desc.nullslast,dim.asc,name.asc",
        ),
        db.select(
            "stats_role_company",
            "company,postings,pay_min,pay_max,latest_posted,url",
            eq,
            order="postings.desc.nullslast,company.asc,url.asc",
            limit=50,
        ),
    )
    if not found:
        raise HTTPException(status_code=404, detail="Role not found")
    return {
        **role_summary(found[0]),
        "sectors": [
            {"sector": s.get("sector"), "slug": s.get("sector_slug"), "postings": s.get("postings")}
            for s in sector_rows
        ],
        "employment_types": dims(dim_rows, "employment_type"),
        "seniority": dims(dim_rows, "seniority"),
        "companies_hiring": [
            {
                "company": c.get("company"),
                "postings": c.get("postings"),
                "pay_min": c.get("pay_min"),
                "pay_max": c.get("pay_max"),
                "latest_posted": c.get("latest_posted"),
                "url": c.get("url"),
            }
            for c in companies
        ],
    }


@app.get("/v1/trends")
async def trends(
    db: Db,
    sector: Annotated[str | None, Query(max_length=120)] = None,
) -> dict[str, Any]:
    slug = check_slug(sector, "Sector") if sector else "all"
    rows, _ = await db.select(
        "stats_trend",
        "granularity,period,postings,pay_median",
        {"sector_slug": f"eq.{slug}"},
        order="granularity.asc,period.asc",
    )
    if not rows and slug != "all":
        found, _ = await db.select(
            "stats_sector", "sector_slug", {"sector_slug": f"eq.{slug}"},
            order="sector_slug.asc", limit=1,
        )
        if not found:
            raise HTTPException(status_code=404, detail="Sector not found")

    by_gran: dict[str, list[Row]] = {"week": [], "month": []}
    for r in rows:
        if r.get("granularity") in by_gran:
            by_gran[r["granularity"]].append(r)
    granularity = "week" if _spans_under_90_days(by_gran["week"]) else "month"
    return {
        "granularity": granularity,
        "points": [
            {
                "period": r.get("period"),
                "postings": r.get("postings"),
                "median_pay": r.get("pay_median"),
            }
            for r in by_gran[granularity]
        ],
    }


def _spans_under_90_days(weeks: list[Row]) -> bool:
    """Same rule as buckets() in web/index.html: weekly under 90 days of data.

    The views only expose bucket starts, so the span is measured from the first
    weekly bucket to the last. No weekly rows at all means monthly.
    """
    try:
        starts = [date.fromisoformat(str(r.get("period"))[:10]) for r in weeks]
    except ValueError:
        log.error("stats_trend returned a period that is not a date")
        raise UpstreamError() from None
    if not starts:
        return False
    return (max(starts) - min(starts)).days < 90
