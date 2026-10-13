from __future__ import annotations

import httpx
import pytest

import main
from conftest import ANON_KEY, PAY_NULL, SUPABASE_URL

CACHE = "public, s-maxage=3600, stale-while-revalidate=86400"
NULL_PAY = {"p25": None, "median": None, "p75": None, "mean": None, "n": 0}
ROLE_KEYS = {"role", "slug", "postings", "companies", "top_sector", "top_sector_slug", "pay"}
SECTOR_KEYS = {"sector", "slug", "postings", "companies", "pay"}
PAY_KEYS = {"p25", "median", "p75", "mean", "n"}


# ------------------------------------------------------------------ healthz


def test_healthz_does_not_touch_supabase(client, db):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert db.requests == []


def test_healthz_works_without_env(client, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    monkeypatch.delenv("SUPABASE_ANON_KEY")
    assert client.get("/healthz").json() == {"ok": True}


# --------------------------------------------------------------------- meta


def test_meta(client, seeded):
    r = client.get("/v1/meta")
    assert r.status_code == 200
    assert r.json() == {
        "last_scrape": "2026-10-13",
        "first_scrape": "2026-09-15",
        "postings": 61234,
        "companies": 14876,
        "median_pay": 4250.0,
        "pay_coverage": 0.8842,
    }
    assert r.headers["cache-control"] == CACHE


def test_meta_empty_view(client, db):
    r = client.get("/v1/meta")
    assert r.status_code == 200
    assert r.json() == {
        "last_scrape": None,
        "first_scrape": None,
        "postings": 0,
        "companies": 0,
        "median_pay": None,
        "pay_coverage": None,
    }


def test_meta_nulls_stay_null(client, seeded):
    seeded.tables["stats_meta"][0].update(pay_median=None, pay_coverage=None)
    body = client.get("/v1/meta").json()
    assert body["median_pay"] is None
    assert body["pay_coverage"] is None
    assert body["postings"] == 61234


# ------------------------------------------------------------------ sectors


def test_sectors_sorted_by_postings(client, seeded):
    r = client.get("/v1/sectors")
    assert r.status_code == 200
    sectors = r.json()["sectors"]
    assert [s["slug"] for s in sectors] == ["information-technology", "f-b", "precision-engineering"]
    assert all(set(s) == SECTOR_KEYS and set(s["pay"]) == PAY_KEYS for s in sectors)
    assert sectors[0] == {
        "sector": "Information Technology",
        "slug": "information-technology",
        "postings": 8120,
        "companies": 2104,
        "pay": {"p25": 5500.0, "median": 7250.0, "p75": 9500.0, "mean": 7684.52, "n": 7402},
    }
    assert sectors[2]["pay"] == NULL_PAY
    assert r.headers["cache-control"] == CACHE


def test_sectors_empty_view(client, db):
    r = client.get("/v1/sectors")
    assert r.status_code == 200
    assert r.json() == {"sectors": []}


def test_sector_detail(client, seeded):
    r = client.get("/v1/sectors/information-technology")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == SECTOR_KEYS | {"employment_types", "seniority", "histogram", "roles"}
    assert body["sector"] == "Information Technology"
    assert body["pay"]["median"] == 7250.0
    assert body["employment_types"] == [
        {"name": "Full Time", "postings": 6405},
        {"name": "Contract", "postings": 1310},
    ]
    assert body["seniority"] == [
        {"name": "Executive", "postings": 3980},
        {"name": "Senior Executive", "postings": 2110},
    ]
    assert body["histogram"] == [
        {"from": 4000, "to": 5000, "count": 655},
        {"from": 5000, "to": 6000, "count": 980},
        {"from": 6000, "to": 7000, "count": 1204},
    ]
    assert [x["slug"] for x in body["roles"]] == ["software-engineer", "data-analyst", "it-intern"]
    for role in body["roles"]:
        assert set(role) == ROLE_KEYS
        assert role["top_sector"] == "Information Technology"
        assert role["top_sector_slug"] == "information-technology"
        assert role["companies"] is None
    assert body["roles"][0]["pay"] == {"p25": 6000.0, "median": 7500.0, "p75": 9500.0, "mean": 7833.33, "n": 871}
    assert body["roles"][2]["pay"] == NULL_PAY
    assert r.headers["cache-control"] == CACHE


def test_sector_detail_with_no_pay_and_no_breakdowns(client, seeded):
    body = client.get("/v1/sectors/precision-engineering").json()
    assert body["pay"] == NULL_PAY
    assert body["employment_types"] == []
    assert body["seniority"] == []
    assert body["histogram"] == []
    assert body["roles"] == []


def test_sector_roles_capped_at_200(client, seeded):
    seeded.tables["stats_sector_role"] = [
        {"sector_slug": "f-b", "role_slug": f"role-{i:04d}", "role": f"Role {i}", "postings": i, **PAY_NULL}
        for i in range(1, 451)
    ]
    roles = client.get("/v1/sectors/f-b").json()["roles"]
    assert len(roles) == 200
    assert [x["postings"] for x in roles] == list(range(450, 250, -1))


@pytest.mark.parametrize("slug", ["no-such-sector", "Information-Technology", "a" * 121, "x;drop", "a.b", "f%26b"])
def test_sector_detail_unknown_slug_is_404(client, seeded, slug):
    r = client.get(f"/v1/sectors/{slug}")
    assert r.status_code == 404
    assert r.json() == {"detail": "Sector not found"}
    assert r.headers["cache-control"] == "no-store"


def test_malformed_slug_never_reaches_supabase(client, seeded):
    for path in ["/v1/sectors/eq.x,or=(a)", "/v1/roles/a*b", "/v1/trends?sector=all%26select=*", "/v1/roles/UPPER"]:
        assert client.get(path).status_code == 404
    assert seeded.requests == []


# -------------------------------------------------------------------- roles


def test_roles_defaults(client, seeded):
    r = client.get("/v1/roles")
    assert r.status_code == 200
    body = r.json()
    # default min_postings=5 leaves out Glass Blower (2 postings)
    assert body["total"] == 5
    assert [x["slug"] for x in body["roles"]] == [
        "service-crew", "software-engineer", "data-analyst", "c-developer-100-remote", "it-intern",
    ]
    assert all(set(x) == ROLE_KEYS and set(x["pay"]) == PAY_KEYS for x in body["roles"])
    assert body["roles"][0] == {
        "role": "Service Crew",
        "slug": "service-crew",
        "postings": 1300,
        "companies": 640,
        "top_sector": "F&B",
        "top_sector_slug": "f-b",
        "pay": {"p25": 2000.0, "median": 2300.0, "p75": 2600.0, "mean": 2320.5, "n": 1233},
    }
    assert body["roles"][4]["pay"] == NULL_PAY
    assert r.headers["cache-control"] == CACHE


def test_roles_min_postings_limit_offset(client, seeded):
    body = client.get("/v1/roles", params={"min_postings": 0}).json()
    assert body["total"] == 6
    assert body["roles"][-1]["slug"] == "glass-blower"

    body = client.get("/v1/roles", params={"min_postings": 100}).json()
    assert (body["total"], len(body["roles"])) == (3, 3)

    body = client.get("/v1/roles", params={"limit": 2, "offset": 1}).json()
    assert body["total"] == 5
    assert [x["slug"] for x in body["roles"]] == ["software-engineer", "data-analyst"]


def test_roles_offset_past_the_end(client, seeded):
    for offset in (5, 6, 5000):  # at the end, and past it (PostgREST answers 416)
        r = client.get("/v1/roles", params={"offset": offset})
        assert r.status_code == 200
        assert r.json() == {"total": 5, "roles": []}


def test_roles_search_is_case_insensitive_substring(client, seeded):
    body = client.get("/v1/roles", params={"q": "ENGIN"}).json()
    assert body == {"total": 1, "roles": body["roles"]}
    assert body["roles"][0]["slug"] == "software-engineer"

    body = client.get("/v1/roles", params={"q": "  data   analyst "}).json()
    assert [x["slug"] for x in body["roles"]] == ["data-analyst"]

    assert client.get("/v1/roles", params={"q": "zzz"}).json() == {"total": 0, "roles": []}
    assert client.get("/v1/roles", params={"q": "   "}).json()["total"] == 5


def test_roles_search_treats_wildcards_literally(client, seeded):
    def slugs(q):
        return [x["slug"] for x in client.get("/v1/roles", params={"q": q}).json()["roles"]]

    assert slugs("%") == ["c-developer-100-remote"]  # only the role with a literal %
    assert slugs("_") == ["c-developer-100-remote"]  # only the role with a literal _
    assert slugs("100% remote_ok") == ["c-developer-100-remote"]
    assert slugs("c++") == ["c-developer-100-remote"]
    assert slugs("d%a") == []  # would match "Data Analyst" if % were a wildcard
    assert slugs("dat_ analyst") == []  # would match if _ were a wildcard
    assert slugs("\\") == []


def test_roles_search_cannot_inject_filters(client, seeded):
    hostile = [
        "x&select=*", "x&postings=gte.0", "eq.1,or=(postings.gte.0)", "*)&limit=5", "a,b)",
        "'; drop table jobs;--", "x\x00\x01", "x\noffset=0",
    ]
    # control characters alone are dropped, which leaves no search at all
    assert client.get("/v1/roles", params={"q": "\x00\x01"}).json()["total"] == 5
    seeded.requests.clear()
    for q in hostile:
        r = client.get("/v1/roles", params={"q": q})
        assert r.status_code == 200, q
        assert r.json()["roles"] == [], q
    for req in seeded.requests:
        assert req.url.path == "/rest/v1/stats_role"
        assert set(req.url.params.keys()) <= {"select", "postings", "role", "order", "limit", "offset"}
        assert req.url.params["postings"] == "gte.5"
        assert req.url.params["role"].startswith("ilike.*")


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": 1001}, {"limit": "abc"}, {"offset": -1}, {"min_postings": -1},
     {"min_postings": "5;x"}, {"q": "a" * 101}],
)
def test_roles_rejects_bad_params(client, seeded, params):
    r = client.get("/v1/roles", params=params)
    assert r.status_code == 422
    assert "detail" in r.json()
    assert seeded.requests == []


def test_roles_empty_view(client, db):
    r = client.get("/v1/roles")
    assert r.status_code == 200
    assert r.json() == {"total": 0, "roles": []}


def _many_roles(n):
    return [
        {"role_slug": f"role-{i:05d}", "role": f"Role {i}", "postings": i, "companies": 1,
         "top_sector": "F&B", "top_sector_slug": "f-b", **PAY_NULL}
        for i in range(1, n + 1)
    ]


def test_roles_paging_past_1000_rows(client, seeded):
    seeded.tables["stats_role"] = _many_roles(2500)
    body = client.get("/v1/roles", params={"limit": 1000, "min_postings": 0}).json()
    assert body["total"] == 2500
    assert [x["postings"] for x in body["roles"]] == list(range(2500, 1500, -1))

    body = client.get("/v1/roles", params={"limit": 1000, "offset": 1800, "min_postings": 0}).json()
    assert body["total"] == 2500
    assert [x["postings"] for x in body["roles"]] == list(range(700, 0, -1))


def test_roles_when_server_row_cap_is_below_the_requested_limit(client, seeded):
    seeded.tables["stats_role"] = _many_roles(730)
    seeded.max_rows = 100  # Supabase "Max rows" setting lowered
    body = client.get("/v1/roles", params={"limit": 250, "offset": 30, "min_postings": 0}).json()
    assert body["total"] == 730
    assert [x["postings"] for x in body["roles"]] == list(range(700, 450, -1))
    assert len(seeded.requests) == 3


def test_role_detail(client, seeded):
    r = client.get("/v1/roles/data-analyst")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == ROLE_KEYS | {"sectors", "employment_types", "seniority", "companies_hiring"}
    assert body["role"] == "Data Analyst"
    assert body["companies"] == 251
    assert body["top_sector_slug"] == "information-technology"
    assert body["pay"] == {"p25": 4500.0, "median": 5500.0, "p75": 6800.0, "mean": 5699.0, "n": 360}
    assert body["sectors"] == [
        {"sector": "Information Technology", "slug": "information-technology", "postings": 310},
        {"sector": "Banking and Finance", "slug": "banking-and-finance", "postings": 78},
    ]
    assert body["employment_types"] == [
        {"name": "Full Time", "postings": 330},
        {"name": "Contract", "postings": 58},
    ]
    assert body["seniority"] == [{"name": "Executive", "postings": 240}]
    assert body["companies_hiring"] == [
        {
            "company": "Example Analytics Pte Ltd",
            "postings": 3,
            "pay_min": 5000,
            "pay_max": 7000,
            "latest_posted": "2026-10-09",
            "url": "https://www.mycareersfuture.gov.sg/job/data-analyst-example-0a1b2c",
        },
        {
            "company": "Sample Logistics Pte Ltd",
            "postings": 1,
            "pay_min": None,
            "pay_max": None,
            "latest_posted": "2026-09-30",
            "url": "https://www.mycareersfuture.gov.sg/job/data-analyst-sample-9f8e7d",
        },
    ]
    assert r.headers["cache-control"] == CACHE


def test_role_detail_with_no_pay_and_no_breakdowns(client, seeded):
    body = client.get("/v1/roles/it-intern").json()
    assert body["pay"] == NULL_PAY
    assert body["sectors"] == []
    assert body["employment_types"] == []
    assert body["seniority"] == []
    assert body["companies_hiring"] == []


def test_role_companies_capped_at_50_and_sectors_page_past_1000(client, seeded):
    seeded.tables["stats_role_company"] = [
        {"role_slug": "service-crew", "company": f"Company {i:04d}", "postings": i,
         "pay_min": 2000, "pay_max": 2600, "latest_posted": "2026-10-01", "url": None}
        for i in range(1, 1301)
    ]
    seeded.tables["stats_role_sector"] = [
        {"role_slug": "service-crew", "sector": f"Sector {i}", "sector_slug": f"sector-{i:04d}", "postings": i}
        for i in range(1, 1206)
    ]
    body = client.get("/v1/roles/service-crew").json()
    assert [c["postings"] for c in body["companies_hiring"]] == list(range(1300, 1250, -1))
    assert [s["postings"] for s in body["sectors"]] == list(range(1205, 0, -1))


@pytest.mark.parametrize("slug", ["no-such-role", "Data-Analyst", "a" * 121, "data_analyst"])
def test_role_detail_unknown_slug_is_404(client, seeded, slug):
    r = client.get(f"/v1/roles/{slug}")
    assert r.status_code == 404
    assert r.json() == {"detail": "Role not found"}


# ------------------------------------------------------------------- trends


def test_trends_all_sectors_weekly_under_90_days(client, seeded):
    r = client.get("/v1/trends")
    assert r.status_code == 200
    body = r.json()
    assert body["granularity"] == "week"
    assert [p["period"] for p in body["points"]] == [
        "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12",
    ]
    assert body["points"][0] == {"period": "2026-09-14", "postings": 11000, "median_pay": 4240.0}
    assert r.headers["cache-control"] == CACHE
    assert client.get("/v1/trends", params={"sector": "all"}).json() == body


def test_trends_for_one_sector_keeps_null_pay(client, seeded):
    body = client.get("/v1/trends", params={"sector": "information-technology"}).json()
    assert body == {
        "granularity": "week",
        "points": [
            {"period": "2026-09-14", "postings": 1500, "median_pay": 7200.0},
            {"period": "2026-09-21", "postings": 3, "median_pay": None},
        ],
    }


def _trend_rows(slug, n_weeks, months):
    from datetime import date, timedelta

    start = date(2001, 1, 1)  # a Monday
    weeks = [
        {"sector_slug": slug, "granularity": "week", "period": (start + timedelta(weeks=i)).isoformat(),
         "postings": i, "pay_median": 3000.0}
        for i in range(n_weeks)
    ]
    return weeks + [
        {"sector_slug": slug, "granularity": "month", "period": m, "postings": 100,
         "pay_median": 3100.0}
        for m in months
    ]


def test_trends_switch_to_monthly_at_90_days(client, seeded):
    months = ["2001-01-01", "2001-02-01", "2001-03-01", "2001-04-01"]
    seeded.tables["stats_trend"] = _trend_rows("all", 13, months)  # first to last bucket: 84 days
    assert client.get("/v1/trends").json()["granularity"] == "week"

    seeded.tables["stats_trend"] = _trend_rows("all", 14, months)  # 91 days
    body = client.get("/v1/trends").json()
    assert body["granularity"] == "month"
    assert [p["period"] for p in body["points"]] == months
    assert body["points"][0] == {"period": "2001-01-01", "postings": 100, "median_pay": 3100.0}


def test_trends_paging_past_1000_rows(client, seeded):
    months = [f"{y}-{m:02d}-01" for y in range(2001, 2026) for m in range(1, 13)]
    seeded.tables["stats_trend"] = _trend_rows("all", 1300, months) + _trend_rows("f-b", 3, ["2001-01-01"])
    body = client.get("/v1/trends").json()
    assert body["granularity"] == "month"
    assert [p["period"] for p in body["points"]] == months  # 300 points, read across two pages
    assert len(seeded.requests) == 2


def test_trends_empty_view(client, db):
    r = client.get("/v1/trends")
    assert r.status_code == 200
    assert r.json() == {"granularity": "month", "points": []}


def test_trends_known_sector_without_points(client, seeded):
    r = client.get("/v1/trends", params={"sector": "precision-engineering"})
    assert r.status_code == 200
    assert r.json() == {"granularity": "month", "points": []}


@pytest.mark.parametrize("slug", ["no-such-sector", "Not A Slug", "a" * 121])
def test_trends_unknown_sector_is_404(client, seeded, slug):
    r = client.get("/v1/trends", params={"sector": slug})
    assert r.status_code == (404 if len(slug) <= 120 else 422)
    if r.status_code == 404:
        assert r.json() == {"detail": "Sector not found"}


# ---------------------------------------------------------- failures -> 503

DATA_PATHS = [
    "/v1/meta",
    "/v1/sectors",
    "/v1/sectors/information-technology",
    "/v1/roles",
    "/v1/roles/data-analyst",
    "/v1/trends",
    "/v1/trends?sector=f-b",
]
SECRET_BODY = "FATAL: password authentication failed for user postgres at db.internal:5432"


def _assert_clean_503(r):
    assert r.status_code == 503
    assert r.json() == {"detail": main.UNAVAILABLE}
    assert r.headers["cache-control"] == "no-store"
    for leak in (ANON_KEY, SUPABASE_URL, "supabase.co", "password", "db.internal", "PGRST"):
        assert leak not in r.text


@pytest.mark.parametrize("path", DATA_PATHS)
@pytest.mark.parametrize(
    "failure",
    [
        httpx.ConnectError("getaddrinfo failed for example-project.supabase.co"),
        httpx.ReadTimeout("timed out"),
        httpx.Response(401, json={"message": "Invalid API key", "hint": SECRET_BODY}),
        httpx.Response(404, json={"code": "PGRST205", "message": SECRET_BODY}),
        httpx.Response(500, text=SECRET_BODY),
        httpx.Response(200, text="<html>" + SECRET_BODY + "</html>"),
        httpx.Response(200, json={"message": SECRET_BODY}),
    ],
    ids=["connect-error", "timeout", "401", "404-missing-view", "500", "not-json", "not-a-list"],
)
def test_supabase_failures_become_503(client, seeded, path, failure):
    seeded.fail_with = failure
    _assert_clean_503(client.get(path))


@pytest.mark.parametrize("path", DATA_PATHS)
@pytest.mark.parametrize(
    "env",
    [
        {},
        {"SUPABASE_URL": "https://example-project.supabase.co"},
        {"SUPABASE_ANON_KEY": "test-anon-key-do-not-leak"},
        {"SUPABASE_URL": "not a url", "SUPABASE_ANON_KEY": "test-anon-key-do-not-leak"},
    ],
    ids=["no-env", "no-key", "no-url", "bad-url"],
)
def test_missing_or_bad_config_is_503(client, seeded, monkeypatch, path, env):
    monkeypatch.delenv("SUPABASE_URL")
    monkeypatch.delenv("SUPABASE_ANON_KEY")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    _assert_clean_503(client.get(path))
    assert seeded.requests == []


def test_view_missing_a_column_is_503_not_silent_nulls(client, seeded):
    for row in seeded.tables["stats_sector"]:
        del row["pay_median"]
    _assert_clean_503(client.get("/v1/sectors"))


# ----------------------------------------------------------- cross-cutting


def test_cors_allows_any_origin(client, seeded):
    r = client.get("/v1/sectors", headers={"Origin": "https://openings.example"})
    assert r.headers["access-control-allow-origin"] == "*"
    # also present without an Origin header, so a CDN-cached copy stays usable
    assert client.get("/v1/sectors").headers["access-control-allow-origin"] == "*"
    assert client.get("/v1/sectors/nope").headers["access-control-allow-origin"] == "*"

    pre = client.options(
        "/v1/roles",
        headers={"Origin": "https://openings.example", "Access-Control-Request-Method": "GET"},
    )
    assert pre.status_code == 200
    assert pre.headers["access-control-allow-origin"] == "*"
    assert "GET" in pre.headers["access-control-allow-methods"]


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_api_is_read_only(client, seeded, method):
    for path in ("/v1/sectors", "/v1/roles/data-analyst", "/v1/meta"):
        assert getattr(client, method)(path).status_code == 405
    assert seeded.requests == []


def test_only_stats_views_are_read_and_only_with_get(client, seeded):
    for path in DATA_PATHS + ["/v1/roles?q=data", "/v1/sectors/nope", "/v1/roles/nope", "/v1/trends?sector=nope"]:
        client.get(path)
    assert seeded.requests
    for req in seeded.requests:
        assert req.method == "GET"
        assert req.url.host == "example-project.supabase.co"
        assert req.url.path.startswith("/rest/v1/stats_")
        assert req.headers["apikey"] == ANON_KEY
        assert req.headers["authorization"] == f"Bearer {ANON_KEY}"
