"""Test fixtures: a small in-memory stand-in for Supabase's PostgREST API.

It implements the parts of PostgREST the back end relies on (eq / gte / ilike
filters, order, limit / offset, a server-side row cap, `Prefer: count=exact`
with Content-Range, and 416 for an offset past the end) so tests exercise the
real query building and paging code.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402

SUPABASE_URL = "https://example-project.supabase.co"
ANON_KEY = "test-anon-key-do-not-leak"

VIEWS = (
    "stats_meta",
    "stats_sector",
    "stats_sector_dim",
    "stats_sector_hist",
    "stats_sector_role",
    "stats_role",
    "stats_role_sector",
    "stats_role_dim",
    "stats_role_company",
    "stats_trend",
)


def _like_to_regex(pattern: str) -> re.Pattern[str]:
    """PostgREST ilike: `*` is `%`; then SQL LIKE with backslash escapes."""
    pattern = pattern.replace("*", "%")
    out, i = [], 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            out.append(re.escape(pattern[i + 1]))
            i += 2
            continue
        out.append(".*" if ch == "%" else "." if ch == "_" else re.escape(ch))
        i += 1
    return re.compile("".join(out), re.IGNORECASE | re.DOTALL)


class FakePostgrest:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {v: [] for v in VIEWS}
        self.max_rows = 1000  # Supabase's default cap
        self.requests: list[httpx.Request] = []
        self.fail_with: httpx.Response | Exception | None = None

    # -- request handling

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if isinstance(self.fail_with, Exception):
            raise self.fail_with
        if self.fail_with is not None:
            return self.fail_with

        assert request.method == "GET"
        assert request.headers["apikey"] == ANON_KEY
        assert request.headers["authorization"] == f"Bearer {ANON_KEY}"
        assert request.url.path.startswith("/rest/v1/")
        view = request.url.path.removeprefix("/rest/v1/")
        if view not in self.tables:  # includes any attempt to read `jobs`
            return httpx.Response(404, json={"code": "PGRST205", "message": f"no relation {view}"})

        params = dict(request.url.params.multi_items())
        columns = params.pop("select").split(",")
        order = params.pop("order", "")
        limit = int(params.pop("limit", self.max_rows))
        offset = int(params.pop("offset", 0))

        rows = list(self.tables[view])
        known = set().union(*(r.keys() for r in rows)) if rows else None
        for col, cond in params.items():
            op, _, value = cond.partition(".")
            if known is not None and col not in known:
                return httpx.Response(400, json={"code": "42703", "message": f"column {col}"})
            if op == "eq":
                rows = [r for r in rows if str(r[col]) == value]
            elif op == "gte":
                rows = [r for r in rows if r[col] is not None and r[col] >= int(value)]
            elif op == "ilike":
                rx = _like_to_regex(value)
                rows = [r for r in rows if r[col] is not None and rx.fullmatch(r[col])]
            else:
                return httpx.Response(400, json={"code": "PGRST100", "message": "bad operator"})
        if known is not None and not set(columns) <= known:
            return httpx.Response(400, json={"code": "42703", "message": "unknown column"})

        for term in reversed([t for t in order.split(",") if t]):
            col, *mods = term.split(".")
            desc = "desc" in mods
            present = [r for r in rows if r[col] is not None]
            missing = [r for r in rows if r[col] is None]
            present.sort(key=lambda r: r[col], reverse=desc)
            # Postgres default: nulls last for asc, first for desc.
            nulls_last = "nullslast" in mods or (not desc and "nullsfirst" not in mods)
            rows = present + missing if nulls_last else missing + present

        total = len(rows)
        if offset > total:
            return httpx.Response(
                416,
                headers={"Content-Range": f"*/{total}"},
                json={"code": "PGRST103", "message": "Requested range not satisfiable"},
            )
        page = rows[offset : offset + min(limit, self.max_rows)]
        body = [{c: r[c] for c in columns} for r in page]
        content_range = f"{offset}-{offset + len(page) - 1}/{total}" if page else f"*/{total}"
        return httpx.Response(
            200 if offset + len(page) >= total else 206,
            headers={"Content-Range": content_range},
            json=body,
        )


# -- realistic rows -----------------------------------------------------------

PAY_NULL = {"pay_p25": None, "pay_median": None, "pay_p75": None, "pay_mean": None, "pay_n": 0}


def pay_cols(p25, median, p75, mean, n):
    return {"pay_p25": p25, "pay_median": median, "pay_p75": p75, "pay_mean": mean, "pay_n": n}


def seed(db: FakePostgrest) -> None:
    t = db.tables
    t["stats_meta"] = [
        {
            "last_scrape": "2026-10-13",
            "first_scrape": "2026-09-15",
            "postings": 61234,
            "openings": 148902,
            "companies": 14876,
            "pay_median": 4250.0,
            "vacancy_coverage": 0.9731,
            "pay_coverage": 0.8842,
        }
    ]
    t["stats_sector"] = [
        {
            "sector": "Information Technology",
            "sector_slug": "information-technology",
            "postings": 8120,
            "openings": 15310,
            "companies": 2104,
            **pay_cols(5500.0, 7250.0, 9500.0, 7684.52, 7402),
        },
        {
            "sector": "F&B",
            "sector_slug": "f-b",
            "postings": 6900,
            "openings": 23870,
            "companies": 1730,
            **pay_cols(2200.0, 2700.0, 3300.0, 2861.4, 6511),
        },
        {
            # every posting in this sector hid its pay
            "sector": "Precision Engineering",
            "sector_slug": "precision-engineering",
            "postings": 12,
            "openings": 31,
            "companies": 7,
            **PAY_NULL,
        },
    ]
    t["stats_sector_dim"] = [
        {"sector_slug": "information-technology", "dim": "employment_type", "name": "Contract", "postings": 1310},
        {"sector_slug": "information-technology", "dim": "employment_type", "name": "Full Time", "postings": 6405},
        {"sector_slug": "information-technology", "dim": "seniority", "name": "Executive", "postings": 3980},
        {"sector_slug": "information-technology", "dim": "seniority", "name": "Senior Executive", "postings": 2110},
        {"sector_slug": "f-b", "dim": "employment_type", "name": "Part Time", "postings": 2890},
    ]
    t["stats_sector_hist"] = [
        {"sector_slug": "information-technology", "bucket_from": 6000, "bucket_to": 7000, "count": 1204},
        {"sector_slug": "information-technology", "bucket_from": 4000, "bucket_to": 5000, "count": 655},
        {"sector_slug": "information-technology", "bucket_from": 5000, "bucket_to": 6000, "count": 980},
        {"sector_slug": "f-b", "bucket_from": 2000, "bucket_to": 3000, "count": 3900},
    ]
    t["stats_sector_role"] = [
        {
            "sector_slug": "information-technology",
            "role_slug": "data-analyst",
            "role": "Data Analyst",
            "postings": 310,
            "openings": 402,
            **pay_cols(4500.0, 5500.0, 6800.0, 5712.9, 288),
        },
        {
            "sector_slug": "information-technology",
            "role_slug": "software-engineer",
            "role": "Software Engineer",
            "postings": 940,
            "openings": 1875,
            **pay_cols(6000.0, 7500.0, 9500.0, 7833.33, 871),
        },
        {
            "sector_slug": "information-technology",
            "role_slug": "it-intern",
            "role": "IT Intern",
            "postings": 6,
            "openings": 9,
            **PAY_NULL,
        },
        {
            "sector_slug": "f-b",
            "role_slug": "service-crew",
            "role": "Service Crew",
            "postings": 1250,
            "openings": 6120,
            **pay_cols(2000.0, 2300.0, 2600.0, 2318.75, 1190),
        },
    ]
    t["stats_role"] = [
        {
            "role_slug": "software-engineer",
            "role": "Software Engineer",
            "postings": 1010,
            "openings": 1990,
            "companies": 512,
            "top_sector": "Information Technology",
            "top_sector_slug": "information-technology",
            **pay_cols(6000.0, 7500.0, 9500.0, 7801.11, 934),
        },
        {
            "role_slug": "service-crew",
            "role": "Service Crew",
            "postings": 1300,
            "openings": 6300,
            "companies": 640,
            "top_sector": "F&B",
            "top_sector_slug": "f-b",
            **pay_cols(2000.0, 2300.0, 2600.0, 2320.5, 1233),
        },
        {
            "role_slug": "data-analyst",
            "role": "Data Analyst",
            "postings": 388,
            "openings": 497,
            "companies": 251,
            "top_sector": "Information Technology",
            "top_sector_slug": "information-technology",
            **pay_cols(4500.0, 5500.0, 6800.0, 5699.0, 360),
        },
        {
            "role_slug": "c-developer-100-remote",
            "role": "C++ Developer (100% Remote_OK)",
            "postings": 7,
            "openings": 7,
            "companies": 3,
            "top_sector": "Information Technology",
            "top_sector_slug": "information-technology",
            **pay_cols(7000.0, 8000.0, 9000.0, 8000.0, 5),
        },
        {
            "role_slug": "it-intern",
            "role": "IT Intern",
            "postings": 6,
            "openings": 9,
            "companies": 5,
            "top_sector": "Information Technology",
            "top_sector_slug": "information-technology",
            **PAY_NULL,
        },
        {
            "role_slug": "glass-blower",
            "role": "Glass Blower",
            "postings": 2,
            "openings": 2,
            "companies": 1,
            "top_sector": "Precision Engineering",
            "top_sector_slug": "precision-engineering",
            **PAY_NULL,
        },
    ]
    t["stats_role_sector"] = [
        {"role_slug": "data-analyst", "sector": "Banking and Finance", "sector_slug": "banking-and-finance", "postings": 78},
        {"role_slug": "data-analyst", "sector": "Information Technology", "sector_slug": "information-technology", "postings": 310},
        {"role_slug": "service-crew", "sector": "F&B", "sector_slug": "f-b", "postings": 1250},
    ]
    t["stats_role_dim"] = [
        {"role_slug": "data-analyst", "dim": "employment_type", "name": "Full Time", "postings": 330},
        {"role_slug": "data-analyst", "dim": "employment_type", "name": "Contract", "postings": 58},
        {"role_slug": "data-analyst", "dim": "seniority", "name": "Executive", "postings": 240},
        {"role_slug": "service-crew", "dim": "seniority", "name": "Non-executive", "postings": 1300},
    ]
    t["stats_role_company"] = [
        {
            "role_slug": "data-analyst",
            "company": "Example Analytics Pte Ltd",
            "postings": 3,
            "openings": 6,
            "pay_min": 5000,
            "pay_max": 7000,
            "latest_posted": "2026-10-09",
            "url": "https://www.mycareersfuture.gov.sg/job/data-analyst-example-0a1b2c",
        },
        {
            "role_slug": "data-analyst",
            "company": "Sample Logistics Pte Ltd",
            "postings": 1,
            "openings": 12,
            "pay_min": None,
            "pay_max": None,
            "latest_posted": "2026-09-30",
            "url": "https://www.mycareersfuture.gov.sg/job/data-analyst-sample-9f8e7d",
        },
    ]
    weeks = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]
    t["stats_trend"] = (
        [
            {"sector_slug": "all", "granularity": "week", "period": p, "postings": 9000 + i * 500,
             "openings": 21000 + i * 900, "pay_median": 4200.0 + i * 10}
            for i, p in enumerate(reversed(weeks))
        ]
        + [
            {"sector_slug": "all", "granularity": "month", "period": "2026-09-01", "postings": 30100,
             "openings": 71000, "pay_median": 4200.0},
            {"sector_slug": "all", "granularity": "month", "period": "2026-10-01", "postings": 31134,
             "openings": 77902, "pay_median": 4300.0},
        ]
        + [
            {"sector_slug": "information-technology", "granularity": "week", "period": weeks[0],
             "postings": 1500, "openings": 2900, "pay_median": 7200.0},
            {"sector_slug": "information-technology", "granularity": "week", "period": weeks[1],
             "postings": 3, "openings": 3, "pay_median": None},
            {"sector_slug": "information-technology", "granularity": "month", "period": "2026-09-01",
             "postings": 1503, "openings": 2903, "pay_median": 7200.0},
        ]
    )


@pytest.fixture
def db(monkeypatch) -> FakePostgrest:
    """An empty Supabase (views exist, no scrape yet)."""
    fake = FakePostgrest()
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_ANON_KEY", ANON_KEY)
    monkeypatch.setattr(main, "TRANSPORT", httpx.MockTransport(fake))
    return fake


@pytest.fixture
def seeded(db: FakePostgrest) -> FakePostgrest:
    seed(db)
    return db


@pytest.fixture
def client(db: FakePostgrest) -> TestClient:
    return TestClient(main.app)
