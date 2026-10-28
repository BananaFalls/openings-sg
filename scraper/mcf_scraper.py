#!/usr/bin/env python3
"""
Openings SG - MyCareersFuture scraper

Pulls job postings from the MyCareersFuture public search API and writes them to
openings.json in the format the Openings SG dashboard reads ("Load scraped data").

Modes
    python3 mcf_scraper.py --all                 # every live listing, crawled sector by sector
    python3 mcf_scraper.py                       # newest postings only (up to --max-pages)
    python3 mcf_scraper.py --category "Information Technology"
    python3 mcf_scraper.py --all --supabase --prune-raw 30   # the daily database run

Crawling --all walks each MCF category separately, so no single query has to
page through the whole site (search APIs often cap deep pagination). Jobs listed
under several categories are de-duplicated by job id.

Each run merges into the existing file. Every record keeps:
    first_seen  - first day the scraper saw the job
    last_seen   - most recent day it was still listed
A job whose last_seen stops advancing has been taken down, which gives you
"days listed" (a rough time-to-fill signal) once you run this daily.

With --supabase the jobs go to the Postgres `jobs` table (db/schema.sql) through
the Supabase REST API instead of a file. It needs SUPABASE_URL and
SUPABASE_SERVICE_KEY in the environment. The search API does not say how many
years of experience a posting asks for or how many vacancies it has, so
--details N then asks the job-details endpoint, one job at a time, for up to N
live jobs that have not been looked up yet.

Standard library only. Keep --delay polite and check MyCareersFuture's terms of
use before running at scale.
"""
import argparse
import datetime as dt
import http.client
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

SEARCH_URL = "https://api.mycareersfuture.gov.sg/v2/search"
JOBS_URL = "https://api.mycareersfuture.gov.sg/v2/jobs"
HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (OpeningsSG research scraper)",
}
MAX_LIMIT = 100       # the API answers HTTP 400 for limit > 100
MAX_OFFSET = 10_000   # page * limit at or past this gets HTTP 418 "Pagination limit reached."

# MyCareersFuture job categories (as shown in the site's category filter).
# If the site renames one, its crawl returns 0 jobs and the summary flags it.
CATEGORIES = [
    "Accounting / Auditing / Taxation", "Admin / Secretarial", "Advertising / Media",
    "Architecture / Interior Design", "Banking and Finance", "Building and Construction",
    "Consulting", "Customer Service", "Design", "Education and Training", "Engineering",
    "Entertainment", "Environment / Health", "Events / Promotions", "F&B",
    "General Management", "General Work", "Healthcare / Pharmaceutical", "Hospitality",
    "Human Resources", "Information Technology", "Insurance", "Legal",
    "Logistics / Supply Chain", "Manufacturing", "Marketing / Public Relations",
    "Medical / Therapy Services", "Others", "Personal Care / Beauty",
    "Precision Engineering", "Professional Services", "Public / Civil Service",
    "Purchasing / Merchandising", "Real Estate / Property Management",
    "Repair and Maintenance", "Risk Management", "Sales / Retail",
    "Sciences / Laboratory / R&D", "Security and Investigation", "Social Services",
    "Telecommunications", "Travel / Tourism", "Wholesale Trade",
]


def http_json(url, body=None, retries=3):
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=HEADERS,
                                         method="POST" if data else "GET")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                wait = 5 * (attempt + 1)
                print(f"  HTTP {e.code}, retrying in {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
        except (OSError, http.client.HTTPException, ValueError) as e:
            # URLError, plus timeouts / dropped connections / bad JSON while reading the body
            if attempt < retries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            if isinstance(e, urllib.error.URLError):
                raise
            raise urllib.error.URLError(e)


class JobLookup:
    """GET /v2/jobs/{uuid} over one connection kept open between lookups.

    Opening a secure connection costs several round trips, which from a server
    abroad was most of each lookup's time. Errors match http_json(): HTTPError for an
    HTTP status, URLError for anything else, after the same retries.
    """

    def __init__(self):
        self.host = urllib.parse.urlsplit(JOBS_URL).netloc
        self.base = urllib.parse.urlsplit(JOBS_URL).path
        self.headers = {k: v for k, v in HEADERS.items() if k != "Content-Type"}
        self.conn = None
        self.opened = 0  # connections opened, for the summary line

    def close(self):
        if self.conn is not None:
            self.conn.close()
            self.conn = None

    def get(self, uuid, retries=3):
        path = f"{self.base}/{urllib.parse.quote(uuid, safe='')}"
        attempt = 0
        while True:
            reused = self.conn is not None
            try:
                if not reused:
                    self.conn = http.client.HTTPSConnection(self.host, timeout=30)
                    self.opened += 1
                self.conn.request("GET", path, headers=self.headers)
                resp = self.conn.getresponse()
                body = resp.read()
                if resp.will_close:
                    self.close()
                if resp.status == 200:
                    return json.loads(body)
            except (OSError, http.client.HTTPException, ValueError) as e:
                self.close()
                if reused and not isinstance(e, ValueError):
                    continue  # the server closed the idle connection: open a new one, no wait
                if attempt < retries - 1:
                    attempt += 1
                    time.sleep(5 * attempt)
                    continue
                raise urllib.error.URLError(e) from None
            if resp.status in (429, 500, 502, 503, 504) and attempt < retries - 1:
                attempt += 1
                print(f"  HTTP {resp.status}, retrying in {5 * attempt}s", file=sys.stderr)
                time.sleep(5 * attempt)
                continue
            raise urllib.error.HTTPError(JOBS_URL + "/" + uuid, resp.status, resp.reason, resp.headers, None)


def fetch_page(page, limit, category=None, use_get=False):
    """Return (results, total). Tries the search endpoint, falls back to /v2/jobs."""
    if not use_get:
        body = {"sessionId": "", "search": "", "sortBy": ["new_posting_date"]}
        if category:
            body["categories"] = [category]
        payload = http_json(f"{SEARCH_URL}?limit={limit}&page={page}", body)
    else:
        payload = http_json(f"{JOBS_URL}?limit={limit}&page={page}")
    return payload.get("results", []) or [], payload.get("total")


def first(items, key):
    if isinstance(items, list) and items and isinstance(items[0], dict):
        return items[0].get(key)
    return None


def to_monthly(value, salary_type):
    if value in (None, ""):
        return None
    value = float(value)
    t = (salary_type or "Monthly").lower()
    if t.startswith("annual") or t.startswith("year"):
        return round(value / 12)
    if t.startswith("hour") or t.startswith("daily") or t.startswith("day"):
        return None  # not comparable with monthly pay; skip
    return round(value)


# ---------- roles and slugs ----------
# role_of() began as a port of roleOf() in web/index.html, which is why the
# character classes are spelled out and the patterns use re.ASCII (JavaScript's
# \s, \b, \d and . differ a little from Python's). It has since moved ahead of the
# old page: job codes, emoji, "Team Lead" / "Head of Sales" and capitals are
# handled here only.
_WS_CHARS = ("\t\n\x0b\x0c\r \xa0     　﻿"
             + "".join(chr(c) for c in range(0x2000, 0x200b)))
_WS = "[" + _WS_CHARS + "]"
_DOT = "[^\n\r  ]"
_BRACKETS = re.compile(rf"\({_DOT}*?\)|\[{_DOT}*?\]")
# "|" and "," always split; a dash or slash only with a space on one side, so
# "Part-time" and "Civil/Structural" stay whole but "YR23- Admin Assistant" splits.
_SPLIT = re.compile(rf"{_WS}[-–—/]|[-–—/]{_WS}|[|,]|{_WS}@{_WS}")
_STRIP = re.compile(
    r"\b(senior|snr|sr|junior|jr|entry[- ]level|fresh graduates?"
    rf"|urgent(ly)?|immediate|hiring|\d+{_WS}*(months?|yrs?|years?)( contract)?)\b\.?",
    re.ASCII | re.IGNORECASE)
# "Lead Engineer" -> "Engineer", but only in front of a role: "Team Lead", "Lead
# Generation Specialist" and a bare "Principal" are roles in their own right.
_LEADING = re.compile(rf"(lead|principal)\b\.?{_WS}+(?!gen(eration)?\b)(?=[^{_WS_CHARS}])",
                      re.ASCII | re.IGNORECASE)
_HASHTAG = re.compile(r"#[A-Za-z0-9]+")
# Agencies put their own reference in front: "6723 - Admin Assistant", "M09 - Data
# Scientist", "ET13496979 Executive Assistant". Not "3D Designer" or "B2B Sales".
_CODE = re.compile(r"\d+|[A-Za-z]{1,3}\d{2,}[A-Za-z]{0,2}", re.ASCII)
_CODE_PREFIX = re.compile(rf"^(\d{{3,}}|[A-Za-z]{{1,3}}\d{{4,}}){_WS}+(?=[^{_WS_CHARS}])", re.ASCII)
_SPACES = re.compile(_WS + "+")
_ACRONYM = re.compile(r"[A-Z0-9&]{2,4}")
# Short words that are not acronyms when a title is typed in capitals ("CHEF").
_PLAIN = frozenset("""
    ALL AND AREA ART AS AT BANK BAR BEST BUS CAFE CALL CAR CARE CASH CHEF CITY COOK CORE
    CREW CUM DATA DAY DAYS DE DESK EARN EAST EXP FAST FIRE FOOD FOOT FOR FREE FULL FUN
    FUND GAME GAS GOOD GRAD GROW GYM HAIR HALF HEAD HELP HIGH HIRE HOME IN JOB JOIN KEY
    LAB LAW LEAD LINE LOAN MIN MORE NAIL NEW NO NOW OF ON ONLY OR OUR OWN PAID PART PAY
    PERM PLAN PORT RISK SAFE SALE SHIP SHOP SHOW SITE SOUS SPA TAX TAXI TEA TEAM TECH
    TEMP TEST THE TIME TO TOOL TUAS UP VAN WALK WEB WEEK WEST WITH WORK YEAR YOU YOUR
    ZONE""".split())
_SMALL = frozenset("and at cum de for in of on or the to with".split())


def _clean(piece):
    """One part of a title with the noise words, reference code and extra spaces removed."""
    s = _SPACES.sub(" ", re.sub(r"[#*!]", "", _STRIP.sub(" ", piece))).strip(_WS_CHARS)
    s = _CODE_PREFIX.sub("", s, count=1)
    while _LEADING.match(s):
        s = _LEADING.sub("", s, count=1)
    return s


def role_of(title):
    """Normalise a job title into a role name: "Senior Data Analyst (Contract)" -> "Data Analyst"."""
    s = "".join(c for c in _BRACKETS.sub(" ", str(title))
                if unicodedata.category(c) not in ("So", "Sk") and c not in "‍️")
    parts = [p for p in map(_clean, _SPLIT.split(_HASHTAG.sub(" ", s))) if p]
    if not parts:
        return "Other"
    # the first part that is a role, not an agency's reference code
    s = next((p for p in parts if not _CODE.fullmatch(p)), parts[0])
    words = []
    for i, w in enumerate(s.split(" ")):
        if _ACRONYM.fullmatch(w) and w not in _PLAIN:
            words.append(w)
        elif i and w.lower() in _SMALL:
            words.append(w.lower())
        else:
            # JavaScript upper-cases one UTF-16 unit, which leaves characters past U+FFFF alone
            head = w[0] if ord(w[0]) > 0xFFFF else w[0].upper()
            words.append(head + w[1:].lower())
    return " ".join(words)


def slugify(text):
    """Shared slug rule: lower-case, each run of anything but a-z 0-9 becomes "-", trimmed."""
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def parse_job(job, fallback_category=None):
    salary = job.get("salary") or {}
    stype = (salary.get("type") or {}).get("salaryType")
    meta = job.get("metadata") or {}
    uuid = job.get("uuid") or meta.get("jobPostId")
    posted = (meta.get("newPostingDate") or meta.get("originalPostingDate")
              or meta.get("createdAt") or "")[:10]
    if not job.get("title") or not posted:
        return None
    title = job.get("title", "").strip()
    sector = first(job.get("categories"), "category") or fallback_category or "Others"
    role = role_of(title)
    return {
        "id": uuid,
        "title": title,
        "company": (job.get("postedCompany") or {}).get("name"),
        "sector": sector,
        "sector_slug": slugify(sector) or "others",
        "role": role,
        "role_slug": slugify(role) or "other",  # e.g. a title with no Latin letters or digits
        "salary_min": to_monthly(salary.get("minimum"), stype),
        "salary_max": to_monthly(salary.get("maximum"), stype),
        "vacancies": job.get("numberOfVacancies") or 1,
        "posted_date": posted,
        "employment_type": first(job.get("employmentTypes"), "employmentType"),
        "seniority": first(job.get("positionLevels"), "position"),
        "url": meta.get("jobDetailsUrl")
               or (f"https://www.mycareersfuture.gov.sg/job/{uuid}" if uuid else None),
    }


# ---------- Supabase (Postgres through its REST API, PostgREST) ----------
SGT = dt.timezone(dt.timedelta(hours=8))  # database dates are Singapore dates
BATCH = 500        # rows per upsert request
PAGE = 1000        # Supabase returns at most 1,000 rows per request by default
INT_MAX = 2**31    # the pay and vacancy columns are 32-bit integers
MAX_EXPERIENCE = 50  # years; anything above is a typing slip, not a requirement
DB_COLUMNS = ("id", "title", "company", "sector", "sector_slug", "role", "role_slug",
              "salary_min", "salary_max", "posted_date", "employment_type", "seniority", "url")


def whole(v, low, high):
    """v if it is a whole number from low to high, else None."""
    return v if isinstance(v, int) and not isinstance(v, bool) and low <= v <= high else None


def names(items, key):
    return [i[key] for i in items or [] if isinstance(i, dict) and i.get(key)]


def company(c):
    return {k: c.get(k) for k in ("uen", "name", "ssicCode2020")} if isinstance(c, dict) else None


def prune(v):
    """Drop nulls, empty strings and empty containers, and the NUL character Postgres rejects."""
    if isinstance(v, dict):
        v = {k: prune(x) for k, x in v.items()}
        return {k: x for k, x in v.items() if x not in (None, "", [], {})}
    if isinstance(v, list):
        return [x for x in map(prune, v) if x not in (None, "", [], {})]
    return v.replace("\x00", "") if isinstance(v, str) else v


def slim_raw(job):
    """What the `raw` column keeps of an MCF job: the fields the clean columns lose
    (every category, the pay as advertised, skills, district, MCF's own ids and dates),
    as names rather than objects. Left out: search scores, links, logos, company
    blurbs, street address and anything already held in a column."""
    meta = job.get("metadata") or {}
    addr = job.get("address") or {}
    return prune({
        "metadata": {k: v for k, v in meta.items() if k != "jobDetailsUrl"},
        "salary": job.get("salary"),
        "status": (job.get("status") or {}).get("jobStatus"),
        "categories": names(job.get("categories"), "category"),
        "employmentTypes": names(job.get("employmentTypes"), "employmentType"),
        "positionLevels": names(job.get("positionLevels"), "position"),
        "flexibleWorkArrangements": names(job.get("flexibleWorkArrangements"),
                                          "flexibleWorkArrangement"),
        "schemes": names([s.get("scheme") for s in job.get("schemes") or []
                          if isinstance(s, dict)], "scheme"),
        "skills": names(job.get("skills"), "skill"),
        "shiftPattern": job.get("shiftPattern"),
        "postedCompany": company(job.get("postedCompany")),
        "hiringCompany": company(job.get("hiringCompany")),
        "address": {"postalCode": addr.get("postalCode"),
                    "districts": names(addr.get("districts"), "location"),
                    "overseasCountry": addr.get("overseasCountry")},
    })


def db_row(rec, job, today):
    """A row for the `jobs` table, or None if the record cannot be stored.

    Three columns are left out on purpose. An upsert only updates the columns it
    is given, so first_seen keeps the day the job was first inserted (the column
    default) and vacancies and min_experience keep what the details pass found. salary_mid is
    generated by the database.
    """
    if not rec["id"]:
        return None
    try:
        dt.date.fromisoformat(rec["posted_date"])
    except ValueError:
        return None
    row = {k: rec[k].replace("\x00", "") if isinstance(rec[k], str) else rec[k]
           for k in DB_COLUMNS}
    row["id"] = str(row["id"])
    for k in ("salary_min", "salary_max"):
        if row[k] is not None and not 0 < row[k] < INT_MAX:
            row[k] = None
    row["last_seen"] = today
    row["raw"] = slim_raw(job)
    return row


class SupabaseError(Exception):
    pass


class Supabase:
    def __init__(self, url, key):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json", "Accept": "application/json"}

    def call(self, method, path, body=None, prefer=None, timeout=120, retries=4):
        """Return (parsed body or None, response headers). Raises SupabaseError."""
        data = json.dumps(body).encode() if body is not None else None
        headers = dict(self.headers, Prefer=prefer) if prefer else self.headers
        what = f"{method} {path.split('?')[0]}"   # never the key, never the full URL
        for attempt in range(retries):
            try:
                req = urllib.request.Request(self.base + path, data=data, headers=headers,
                                             method=method)
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    text = resp.read()
                    return (json.loads(text) if text else None), resp.headers
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:500]
                if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                    wait = 5 * (attempt + 1)
                    print(f"  database HTTP {e.code}, retrying in {wait}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
                raise SupabaseError(f"{what}: HTTP {e.code} {detail}") from None
            except (OSError, http.client.HTTPException, ValueError) as e:
                if attempt < retries - 1:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise SupabaseError(f"{what}: {e}") from None

    def rpc(self, name, args=None, **kw):
        return self.call("POST", f"/rpc/{name}", args or {}, **kw)[0]

    def count(self, table, query):
        headers = self.call("HEAD", f"/{table}?select=id&limit=1&{query}",
                            prefer="count=exact")[1]
        total = (headers.get("Content-Range") or "").rpartition("/")[2]
        return int(total) if total.isdigit() else "?"


class JobSink:
    """Collects rows for the `jobs` table and upserts them a batch at a time."""

    def __init__(self, db, today):
        self.db, self.today, self.rows, self.saved, self.skipped = db, today, {}, 0, 0

    def add(self, rec, job):
        row = db_row(rec, job, self.today)
        if row is None:
            self.skipped += 1
            return
        self.rows[row["id"]] = row  # one statement cannot upsert the same id twice
        if len(self.rows) >= BATCH:
            self.flush()

    def flush(self):
        if not self.rows:
            return
        self.db.call("POST", "/jobs?on_conflict=id", list(self.rows.values()),
                     prefer="resolution=merge-duplicates,return=minimal")
        self.saved += len(self.rows)
        self.rows = {}


def fetch_details(db, today, args, every=None):
    """Store the years of experience asked for, and the vacancy count, of up to --details
    live jobs that have not been looked up, newest first (only --details-sectors, if
    given). With fewer lookups than new postings a day this covers a sample of each
    day's postings, not all of them. every(), if given, is called after each 1,000
    jobs stored. Returns (jobs stored, False if MCF kept failing and the pass gave up)."""
    only = f"&sector_slug=in.({args.details_sectors})" if args.details_sectors else ""
    ids = []
    while len(ids) < args.details:
        want = min(PAGE, args.details - len(ids))
        rows = db.call("GET", f"/jobs?select=id&min_experience=is.null&last_seen=eq.{today}{only}"
                              f"&order=posted_date.desc,id.asc&limit={want}&offset={len(ids)}")[0]
        ids += [r["id"] for r in rows or []]
        if len(rows or []) < want:
            break
    print(f"\nLooking up details for {len(ids)} jobs")
    pending, found, gone, failed, streak = [], 0, 0, 0, 0
    lookup = JobLookup()

    def save():
        if pending:
            db.rpc("set_details", {"items": pending})
            pending.clear()

    for i, uuid in enumerate(ids):
        if i:
            time.sleep(args.delay)
        try:
            job = lookup.get(uuid)
        except urllib.error.URLError as e:
            if getattr(e, "code", None) in (404, 410):  # taken down since the crawl
                gone, streak = gone + 1, 0
                continue
            failed, streak = failed + 1, streak + 1
            if streak >= 10:
                print("  stopped: 10 lookups in a row failed", file=sys.stderr)
                break
            continue
        streak = 0
        job = job if isinstance(job, dict) else {}
        years = whole(job.get("minimumYearsExperience"), 0, MAX_EXPERIENCE)
        if years is not None:
            pending.append({"id": uuid, "min_experience": years,
                            "vacancies": whole(job.get("numberOfVacancies"), 1, INT_MAX - 1)})
            found += 1
        if len(pending) >= 100:
            save()
            if every and found % 1000 < 100 and found >= 1000:
                every()
    save()
    lookup.close()
    print(f"Details stored for {found} jobs ({gone} no longer listed, {failed} failed, "
          f"{len(ids) - found - gone - failed} not stated or not reached; "
          f"{lookup.opened} connections opened)")
    return found, streak < 10


def run_details_only(db, args):
    """--details-only: the details pass for the jobs of the latest crawl, without crawling.
    Returns the process exit code."""
    problems = []
    try:
        latest = db.call("GET", "/jobs?select=last_seen&order=last_seen.desc&limit=1")[0]
        if not latest:
            print("No jobs in the database yet", file=sys.stderr)
            return 1
        day = latest[0]["last_seen"]
        # Refresh only when the stats already show that crawl in full. Then a refresh
        # changes the experience figures and nothing else; after a partial crawl it
        # would shrink the site, so it is left to the next whole crawl.
        meta = db.call("GET", "/stats_meta?select=last_scrape,postings")[0] or [{}]
        current = (meta[0].get("last_scrape") == day
                   and meta[0].get("postings") == db.count("jobs", f"last_seen=eq.{day}"))
    except SupabaseError as e:
        print(f"Cannot read the latest crawl: {e}", file=sys.stderr)
        return 1

    def refresh():
        # Several sectors may run side by side; if another one is refreshing, the
        # database answers "lock timeout" (55P03). Wait for it rather than fail.
        for attempt in range(4):
            try:
                db.rpc("trigger_refresh_stats_async", timeout=900, retries=1)
                print("Stats refreshed", flush=True)
                return
            except SupabaseError as e:
                if "55P03" in str(e) and attempt < 3:
                    time.sleep(30)
                    continue
                problems.append(f"Stats refresh failed: {e}")
                return

    print(f"Details for the crawl of {day}"
          + (f", sectors {args.details_sectors}" if args.details_sectors else ""))
    try:
        found, ok = fetch_details(db, day, args, every=refresh if current else None)
        if not ok:
            problems.append("The details lookups stopped early.")
    except SupabaseError as e:
        found = 0
        problems.append(f"Database write failed during the details pass: {e}")
    if current and found:
        refresh()
    elif not current:
        print("Stats not refreshed: they do not show the latest crawl in full")
    for p in problems:
        print(p, file=sys.stderr)
    return 1 if problems else 0


def run_supabase(args, targets):
    """The --supabase run. Returns the process exit code."""
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("--supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment",
              file=sys.stderr)
        return 2
    db = Supabase(url.strip(), key.strip())
    today = dt.datetime.now(SGT).date().isoformat()
    sink = JobSink(db, today)
    empty, incomplete, problems, crawled = [], [], [], False
    try:
        db.call("GET", "/jobs?select=id&limit=1")  # fail now, not after a 20 minute crawl
    except SupabaseError as e:
        print(f"Cannot read the jobs table: {e}\nIs db/schema.sql applied, and is the key "
              "the service role key?", file=sys.stderr)
        return 2
    if args.details_only:
        return run_details_only(db, args)
    try:
        for cat in targets:
            label = cat or "all (newest first)"
            seen, total, complete = crawl(cat, args, None, today, sink)
            sink.flush()
            print(f"{label}: {seen} jobs fetched (site reports {total})")
            if cat and seen == 0:
                empty.append(cat)
            elif not complete:
                incomplete.append(label)
        crawled = True
    except SupabaseError as e:
        # carrying on would drop rows silently, so stop here
        problems.append(f"Database write failed, run abandoned: {e}")
    print(f"\n{sink.saved} rows saved to the database"
          + (f", {sink.skipped} skipped (no id or bad date)" if sink.skipped else ""))

    def refresh():
        try:
            db.rpc("refresh_stats", timeout=900, retries=1)
            print("Stats refreshed")
            return True
        except SupabaseError as e:
            problems.append(f"Stats refresh failed, the site still shows the old numbers: {e}")
            return False

    # The stats count a posting as live only if the latest run saw it, so a refresh
    # after a partial crawl would shrink the site to whatever that run reached.
    # Only a whole crawl refreshes; otherwise the site keeps the last good numbers.
    # The site and the history are updated straight after the crawl, before the
    # slow details pass, so that pass can neither delay nor spoil them.
    whole = args.all and crawled and not (empty or incomplete)
    if whole:
        refreshed = refresh()
    elif args.all:
        print("Stats not refreshed: the crawl was not complete, "
              "so the site keeps the numbers from the last full crawl")
    else:
        print("Stats not refreshed: only a full crawl (--all) updates the site")
    # One row per sector and popular role for today, kept for good. Only after a
    # full, clean crawl: a partial day would sit in the history as a false dip.
    if whole and not problems:
        try:
            print(f'History saved for {db.rpc("snapshot_stats", timeout=300)}')
        except SupabaseError as e:
            problems.append(f"History snapshot failed, today is missing from the history: {e}")
    elif args.all:
        print("History not saved for today: the crawl was not complete")

    if crawled:
        found = 0
        try:
            if args.details:
                found, ok = fetch_details(db, today, args)
                if not ok:
                    problems.append("The details lookups stopped early.")
            if args.prune_raw:
                n = db.rpc("prune_raw", {"keep_days": args.prune_raw})
                print(f"Cleared raw data on {n} jobs delisted for over {args.prune_raw} days")
        except SupabaseError as e:
            problems.append(f"Database write failed during the details pass: {e}")
        # once more, so the pay-by-experience figures include tonight's lookups
        if whole and refreshed and found:
            refresh()
    try:
        print(f'{db.count("jobs", f"last_seen=eq.{today}")} jobs live today, '
              f'{db.count("jobs", f"first_seen=eq.{today}")} new')
    except SupabaseError:
        pass  # only a summary line; anything that matters is already in `problems`
    if empty:
        print("No jobs returned for: " + ", ".join(empty) +
              "\nCheck these names against the category filter on mycareersfuture.gov.sg.")
    if incomplete:
        print("Crawl stopped early for: " + ", ".join(incomplete) +
              "\nJobs it did not reach keep their old last_seen.")
    for p in problems:
        print(p, file=sys.stderr)
    return 1 if empty or incomplete or problems else 0


def crawl(category, args, store, today, sink=None):
    """Page through one category (or everything if None). Returns (seen, total, complete).
    Jobs go into `store`, or to the database through `sink` when one is given."""
    use_get, seen, total, page, complete = False, 0, None, 0, True
    while page < args.max_pages:
        if not use_get and page * args.limit >= MAX_OFFSET:
            print(f"  stopped at page {page}: the search API only serves the first "
                  f"{MAX_OFFSET} results of a query", file=sys.stderr)
            complete = False
            break
        try:
            results, total = fetch_page(page, args.limit, category, use_get)
        except urllib.error.HTTPError as e:
            if not use_get and category is None and e.code in (400, 404, 405):
                print("  search endpoint refused; switching to /v2/jobs")
                use_get = True
                continue
            print(f"  stopped at page {page}: HTTP {e.code}", file=sys.stderr)
            complete = False
            break
        except urllib.error.URLError as e:
            print(f"  stopped at page {page}: {e.reason}", file=sys.stderr)
            complete = False
            break
        if not results:
            break
        for job in results:
            rec = parse_job(job, category)
            if not rec:
                continue
            if sink:
                sink.add(rec, job)
                seen += 1
                continue
            key = rec["id"] or f'{rec["title"]}|{rec["posted_date"]}'
            old = store.get(key)
            rec["first_seen"] = old.get("first_seen", today) if old else today
            rec["last_seen"] = today
            store[key] = rec
            seen += 1
        page += 1
        if total and page * args.limit >= total:
            break
        time.sleep(args.delay)
    return seen, total, complete


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="openings.json")
    ap.add_argument("--all", action="store_true", help="crawl every category to get every live job")
    ap.add_argument("--category", help='a single category, e.g. "Information Technology"')
    ap.add_argument("--limit", type=int, default=100, help="results per page (max 100)")
    ap.add_argument("--max-pages", type=int, default=None,
                    help="page cap per crawl (default: unlimited with --all, 50 otherwise)")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    ap.add_argument("--supabase", action="store_true",
                    help="save to the Supabase jobs table instead of --out "
                         "(needs SUPABASE_URL and SUPABASE_SERVICE_KEY)")
    ap.add_argument("--details", type=int, default=0, metavar="N",
                    help="with --supabase: look up years of experience and vacancies for up to N "
                         "live jobs that lack them")
    ap.add_argument("--details-sectors", metavar="SLUGS",
                    help="with --details: only jobs in these sectors, e.g. engineering,information-technology")
    ap.add_argument("--details-only", action="store_true",
                    help="with --details: skip the crawl and look up jobs from the latest crawl")
    ap.add_argument("--prune-raw", type=int, default=0, metavar="DAYS",
                    help="with --supabase: clear the raw column of jobs delisted for over DAYS "
                         "days, to save database space (default: keep everything)")
    args = ap.parse_args()
    if not 1 <= args.limit <= MAX_LIMIT:
        ap.error(f"--limit must be between 1 and {MAX_LIMIT}")
    if (args.details or args.prune_raw) and not args.supabase:
        ap.error("--details and --prune-raw only work with --supabase")
    if (args.details_sectors or args.details_only) and not args.details:
        ap.error("--details-sectors and --details-only need --details N")
    if args.details_only and (args.all or args.category or args.prune_raw):
        ap.error("--details-only does not crawl; leave out --all, --category and --prune-raw")
    if args.details_sectors and not re.fullmatch(r"[a-z0-9-]+(,[a-z0-9-]+)*", args.details_sectors):
        ap.error("--details-sectors takes sector slugs joined by commas, e.g. engineering,f-b")
    if args.details < 0 or args.prune_raw < 0:
        ap.error("--details and --prune-raw cannot be negative")
    if args.max_pages is None:
        args.max_pages = 10_000 if args.all else 50
    if args.supabase:
        sys.exit(run_supabase(args, CATEGORIES if args.all else [args.category]))

    today = dt.date.today().isoformat()
    store = {}
    if os.path.exists(args.out):
        with open(args.out, encoding="utf-8") as f:
            for rec in json.load(f):
                store[rec.get("id") or f'{rec["title"]}|{rec["posted_date"]}'] = rec
    before = len(store)
    print(f"Loaded {before} existing records from {args.out}")

    targets = CATEGORIES if args.all else [args.category]
    empty, incomplete = [], []
    for cat in targets:
        label = cat or "all (newest first)"
        seen, total, complete = crawl(cat, args, store, today)
        print(f"{label}: {seen} jobs fetched (site reports {total})")
        if cat and seen == 0:
            empty.append(cat)
        elif not complete:
            incomplete.append(label)

    live = sum(1 for r in store.values() if r.get("last_seen") == today)
    records = sorted(store.values(), key=lambda r: r["posted_date"], reverse=True)
    # write to a temp file first so a failed write can't destroy the existing data
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=1)
    os.replace(tmp, args.out)
    print(f"\n{live} jobs live today, {len(store) - before} new. "
          f"{len(records)} total records saved to {args.out}")
    if empty:
        print("No jobs returned for: " + ", ".join(empty) +
              "\nCheck these names against the category filter on mycareersfuture.gov.sg.")
    if incomplete:
        print("Crawl stopped early for: " + ", ".join(incomplete) +
              "\nJobs it did not reach keep their old last_seen.")
    if empty or incomplete:
        sys.exit(1)  # the file is saved, but let a scheduled run show as failed


if __name__ == "__main__":
    main()
