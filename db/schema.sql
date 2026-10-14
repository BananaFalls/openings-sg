-- Openings SG: Supabase (Postgres 15+) schema.
--
-- Paste the whole file into the Supabase SQL editor and run it. It is safe to run
-- again: the table and its data are kept, the stats views are dropped and rebuilt
-- from it, and the functions are replaced.
--
-- Who can do what
--   anon (the public key)   read the stats_* views. Nothing else: no access to
--                           `jobs`, no functions.
--   service_role            everything. Only the scraper and the back end hold
--                           this key. Never ship it to a browser.
--
-- Words used below
--   live      a posting seen in the latest scrape: last_seen = max(last_seen).
--             A scrape that misses a sector would leave that sector's jobs out,
--             so the scraper only refreshes the stats after a whole crawl.
--   postings  listings. Every statistic counts postings. MCF's search results do
--             not say how many people a posting is hiring for, so vacancies are
--             not counted (the `vacancies` column is stored but unused).
--   experience  the least years of experience a posting asks for (MCF's
--             minimumYearsExperience). Only the job-details endpoint has it, one
--             job per request, so it is known for a sample of postings: those
--             the scraper's --details pass has looked up. NULL = not looked up.
--   history   one small row per day, sector and popular role, written by
--             snapshot_stats() after each full crawl and never pruned. MCF only
--             shows what is live today, so this cannot be rebuilt later.
--   pay       monthly SGD, the midpoint of the advertised range (salary_mid).

begin;

-- ---------------------------------------------------------------- jobs

create table if not exists public.jobs (
  id              text primary key,            -- MCF uuid
  title           text not null,
  company         text,
  sector          text not null,               -- first MCF category on the job
  sector_slug     text not null,
  role            text not null,               -- title normalised by the scraper's role_of()
  role_slug       text not null,
  salary_min      integer,                     -- monthly SGD
  salary_max      integer,
  -- salary_mid, the pay every statistic uses, is added under "pay rule" below.
  vacancies       integer,                     -- NULL = not yet known (set by the details pass)
  min_experience  integer,                     -- years asked for; NULL = not yet known (details pass)
  posted_date     date not null,
  employment_type text,
  seniority       text,
  url             text,
  -- Singapore dates. The scraper never sends first_seen, so an upsert leaves it alone.
  first_seen      date not null default ((now() at time zone 'Asia/Singapore')::date),
  last_seen       date not null,
  raw             jsonb                        -- slimmed MCF object, see slim_raw() in the scraper
);

-- For a table made before this column existed.
alter table public.jobs add column if not exists min_experience integer;

-- Finds the live postings, and the latest scrape date.
create index if not exists jobs_last_seen_idx on public.jobs (last_seen);
-- The scraper's "live jobs not looked up yet, newest first" lookup.
drop index if exists public.jobs_vacancy_todo_idx;
create index if not exists jobs_details_todo_idx on public.jobs (last_seen, posted_date desc)
  where min_experience is null;
-- No sector or role indexes: nothing reads `jobs` by them (the site reads the
-- stats views) and on the 500 MB free tier every index costs space.

-- Row level security with no policies: anon and authenticated can do nothing.
-- The service role bypasses RLS.
alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;
grant select, insert, update, delete on public.jobs to service_role;

-- ---------------------------------------------------------------- history
-- Daily snapshots of the live postings. `day` is the scrape date (Singapore).
-- These rows are the long-term record: they stay when old jobs are pruned.

create table if not exists public.history_sector (
  day          date    not null,
  sector_slug  text    not null,     -- 'all' = every sector together
  postings     integer not null,     -- live that day
  new_postings integer not null,     -- first seen that day (on the first day: all of them)
  companies    integer not null,
  pay_median   integer,              -- monthly SGD, NULL when no posting stated usable pay
  primary key (day, sector_slug)
);

-- Roles with at least 10 live postings that day, to keep this table small.
create table if not exists public.history_role (
  day          date    not null,
  role_slug    text    not null,
  postings     integer not null,
  pay_median   integer,
  primary key (day, role_slug)
);

-- Not public yet: nothing reads these until there is enough history to show.
alter table public.history_sector enable row level security;
alter table public.history_role   enable row level security;
revoke all on public.history_sector, public.history_role from anon, authenticated;
grant select, insert, update, delete on public.history_sector, public.history_role to service_role;

-- ---------------------------------------------------------------- stats views
-- Pay columns are whole dollars. pay_n is how many postings the pay figures rest on.

drop materialized view if exists public.stats_meta;
drop materialized view if exists public.stats_sector;
drop materialized view if exists public.stats_sector_dim;
drop materialized view if exists public.stats_sector_hist;
drop materialized view if exists public.stats_sector_role;
drop materialized view if exists public.stats_sector_exp;
drop materialized view if exists public.stats_sector_exp_role;
drop materialized view if exists public.stats_role;
drop materialized view if exists public.stats_role_sector;
drop materialized view if exists public.stats_role_dim;
drop materialized view if exists public.stats_role_company;
drop materialized view if exists public.stats_trend;

-- ---------------------------------------------------------------- pay rule
-- salary_mid = midpoint of the advertised range, or the one figure given.
-- Junk rule: the pay is treated as missing, so salary_mid is NULL and the
-- posting is left out of every pay statistic, when
--   the highest figure is under 300 a month (MCF has postings with pay such as
--   1-1 or 13-15, about 2% of jobs), or
--   the midpoint is over 50,000 a month (a handful of postings, nearly all a
--   yearly figure entered as monthly, e.g. 254,000).
-- salary_min and salary_max keep what was advertised.
--
-- A generated column cannot be edited in place, so when the rule stored in the
-- database is not this one the column is dropped and added again, which
-- recalculates every row. It sits here because the views that read it have just
-- been dropped. To change a limit, change the number in both places below.
do $$
begin
  if not exists (
    select 1
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.jobs'::regclass and a.attname = 'salary_mid' and not a.attisdropped
      and pg_get_expr(d.adbin, d.adrelid) like '%300%'
      and pg_get_expr(d.adbin, d.adrelid) like '%50000%'
  ) then
    alter table public.jobs drop column if exists salary_mid;
    alter table public.jobs add column salary_mid numeric generated always as (
      case when greatest(nullif(salary_min, 0), nullif(salary_max, 0)) >= 300
            and coalesce(nullif(salary_min, 0), salary_max)::numeric
                + coalesce(nullif(salary_max, 0), salary_min) <= 2 * 50000
           then round((coalesce(nullif(salary_min, 0), salary_max)::numeric
                       + coalesce(nullif(salary_max, 0), salary_min)) / 2, 1)
      end) stored;
  end if;
end;
$$;

-- One row. All NULL / 0 until the first scrape.
create materialized view public.stats_meta as
select
  (select max(last_seen) from public.jobs)                                          as last_scrape,
  (select min(first_seen) from public.jobs)                                         as first_scrape,
  count(*)::int                                                                     as postings,
  count(distinct company)::int                                                      as companies,
  round(percentile_cont(0.5) within group (order by salary_mid::float8))::int       as pay_median,
  round(count(salary_mid)::numeric / nullif(count(*), 0), 4)                        as pay_coverage
from public.jobs
where last_seen = (select max(last_seen) from public.jobs);

create materialized view public.stats_sector as
select
  mode() within group (order by sector)                                             as sector,
  sector_slug,
  count(*)::int                                                                     as postings,
  count(distinct company)::int                                                      as companies,
  round(percentile_cont(0.25) within group (order by salary_mid::float8))::int      as pay_p25,
  round(percentile_cont(0.5)  within group (order by salary_mid::float8))::int      as pay_median,
  round(percentile_cont(0.75) within group (order by salary_mid::float8))::int      as pay_p75,
  round(avg(salary_mid))::int                                                       as pay_mean,
  count(salary_mid)::int                                                            as pay_n
from public.jobs
where last_seen = (select max(last_seen) from public.jobs)
group by sector_slug;

-- Employment type and seniority mix. A posting with neither stated is 'Not stated'.
create materialized view public.stats_sector_dim as
select j.sector_slug, d.dim, d.name, count(*)::int as postings
from public.jobs j
cross join lateral (values
  ('employment_type'::text, coalesce(nullif(j.employment_type, ''), 'Not stated')),
  ('seniority'::text,       coalesce(nullif(j.seniority, ''), 'Not stated'))
) as d(dim, name)
where j.last_seen = (select max(last_seen) from public.jobs)
group by j.sector_slug, d.dim, d.name;

-- Pay histogram per sector, following histogram() in web/index.html:
--   top  = the 97th percentile of pay rounded up to a "nice" number
--          (1, 2, 2.5, 5 or 10 times a power of ten), capped at 20,000
--   step = 500 when top <= 8,000, otherwise 1,000
--   buckets run from 0 to top; a posting falls in [bucket_from, bucket_to)
-- The LAST bucket of each sector also holds everything above it (label it
-- "bucket_from+"). Empty buckets are present with count 0. Sectors with no pay
-- data have no rows.
create materialized view public.stats_sector_hist as
with live as (
  select sector_slug, salary_mid::float8 as mid
  from public.jobs
  where last_seen = (select max(last_seen) from public.jobs) and salary_mid is not null
), p as (
  select sector_slug, percentile_cont(0.97) within group (order by mid) as p97
  from live group by sector_slug
), m as (
  select sector_slug, p97, power(10::float8, floor(log10(p97))) as mag from p
), t as (
  select sector_slug,
         least(20000::float8, mag * case when p97 / mag <= 1   then 1
                                         when p97 / mag <= 2   then 2
                                         when p97 / mag <= 2.5 then 2.5
                                         when p97 / mag <= 5   then 5
                                         else 10 end) as top
  from m
), b as (
  select sector_slug, step, ceil(top / step)::int as n
  from (select sector_slug, top, case when top <= 8000 then 500 else 1000 end as step from t) s
), c as (
  select l.sector_slug, least(b.n - 1, floor(l.mid / b.step))::int as i, count(*) as cnt
  from live l join b on b.sector_slug = l.sector_slug
  group by l.sector_slug, least(b.n - 1, floor(l.mid / b.step))::int
)
select b.sector_slug,
       (g.i * b.step)::int       as bucket_from,
       ((g.i + 1) * b.step)::int as bucket_to,
       coalesce(c.cnt, 0)::int   as "count"
from b
cross join lateral generate_series(0, b.n - 1) as g(i)
left join c on c.sector_slug = b.sector_slug and c.i = g.i;

create materialized view public.stats_sector_role as
select
  sector_slug,
  role_slug,
  mode() within group (order by role)                                               as role,
  count(*)::int                                                                     as postings,
  round(percentile_cont(0.25) within group (order by salary_mid::float8))::int      as pay_p25,
  round(percentile_cont(0.5)  within group (order by salary_mid::float8))::int      as pay_median,
  round(percentile_cont(0.75) within group (order by salary_mid::float8))::int      as pay_p75,
  round(avg(salary_mid))::int                                                       as pay_mean,
  count(salary_mid)::int                                                            as pay_n
from public.jobs
where last_seen = (select max(last_seen) from public.jobs)
group by sector_slug, role_slug;

-- The experience levels, by the least years a posting asks for (years_to NULL =
-- or more). They follow what employers ask for: in a sample of 2,500 postings
-- (Oct 2026) almost every posting named 0, 1, 2, 3, 5, 8 or 10 years; pay was flat
-- from 0 to 2 years, stepped up at 3 and again past 5. To change the levels, edit
-- this list and run the file again.
create or replace view public.exp_levels (years_from, years_to, level) as
values (0, 2, 'Junior'), (3, 5, 'Mid-level'), (6, null::int, 'Senior');
revoke all on public.exp_levels from anon, authenticated;

-- Pay by experience level per sector, from the live postings whose experience
-- has been looked up (a sample, see "experience" at the top). `postings` is how
-- many of those fall in the level. A level with no such posting has no row.
create materialized view public.stats_sector_exp as
select
  j.sector_slug,
  b.years_from,
  b.years_to,                                                                       -- NULL = or more
  b.level,
  count(*)::int                                                                     as postings,
  round(percentile_cont(0.25) within group (order by j.salary_mid::float8))::int    as pay_p25,
  round(percentile_cont(0.5)  within group (order by j.salary_mid::float8))::int    as pay_median,
  round(percentile_cont(0.75) within group (order by j.salary_mid::float8))::int    as pay_p75,
  round(avg(j.salary_mid))::int                                                     as pay_mean,
  count(j.salary_mid)::int                                                          as pay_n
from public.jobs j
join public.exp_levels b
  on j.min_experience >= b.years_from and (b.years_to is null or j.min_experience <= b.years_to)
where j.last_seen = (select max(last_seen) from public.jobs)
group by j.sector_slug, b.years_from, b.years_to, b.level;

-- The roles behind each level: which jobs a sector offers at that experience,
-- and what they advertise. Same sample of postings as stats_sector_exp.
create materialized view public.stats_sector_exp_role as
select
  j.sector_slug,
  b.years_from,
  j.role_slug,
  mode() within group (order by j.role)                                             as role,
  count(*)::int                                                                     as postings,
  round(percentile_cont(0.25) within group (order by j.salary_mid::float8))::int    as pay_p25,
  round(percentile_cont(0.5)  within group (order by j.salary_mid::float8))::int    as pay_median,
  round(percentile_cont(0.75) within group (order by j.salary_mid::float8))::int    as pay_p75,
  round(avg(j.salary_mid))::int                                                     as pay_mean,
  count(j.salary_mid)::int                                                          as pay_n
from public.jobs j
join public.exp_levels b
  on j.min_experience >= b.years_from and (b.years_to is null or j.min_experience <= b.years_to)
where j.last_seen = (select max(last_seen) from public.jobs)
group by j.sector_slug, b.years_from, j.role_slug;

-- role = the most common spelling among the postings sharing the slug.
-- top_sector = the sector with the most postings for the role.
create materialized view public.stats_role as
with live as (
  select role_slug, role, sector_slug, sector, company, salary_mid
  from public.jobs
  where last_seen = (select max(last_seen) from public.jobs)
), r as (
  select
    role_slug,
    mode() within group (order by role)                                             as role,
    count(*)::int                                                                   as postings,
    count(distinct company)::int                                                    as companies,
    round(percentile_cont(0.25) within group (order by salary_mid::float8))::int    as pay_p25,
    round(percentile_cont(0.5)  within group (order by salary_mid::float8))::int    as pay_median,
    round(percentile_cont(0.75) within group (order by salary_mid::float8))::int    as pay_p75,
    round(avg(salary_mid))::int                                                     as pay_mean,
    count(salary_mid)::int                                                          as pay_n
  from live group by role_slug
), s as (
  select distinct on (role_slug) role_slug, sector, sector_slug
  from (
    select role_slug, sector_slug, mode() within group (order by sector) as sector, count(*) as n
    from live group by role_slug, sector_slug
  ) x
  order by role_slug, n desc, sector_slug
)
select r.role_slug, r.role, r.postings, r.companies,
       s.sector as top_sector, s.sector_slug as top_sector_slug,
       r.pay_p25, r.pay_median, r.pay_p75, r.pay_mean, r.pay_n
from r join s on s.role_slug = r.role_slug;

create materialized view public.stats_role_sector as
select role_slug,
       mode() within group (order by sector) as sector,
       sector_slug,
       count(*)::int                         as postings
from public.jobs
where last_seen = (select max(last_seen) from public.jobs)
group by role_slug, sector_slug;

create materialized view public.stats_role_dim as
select j.role_slug, d.dim, d.name, count(*)::int as postings
from public.jobs j
cross join lateral (values
  ('employment_type'::text, coalesce(nullif(j.employment_type, ''), 'Not stated')),
  ('seniority'::text,       coalesce(nullif(j.seniority, ''), 'Not stated'))
) as d(dim, name)
where j.last_seen = (select max(last_seen) from public.jobs)
group by j.role_slug, d.dim, d.name;

-- Companies hiring for a role. Postings with no company name are left out.
-- pay_min / pay_max: lowest and highest advertised figure, ignoring junk pay.
create materialized view public.stats_role_company as
select
  role_slug,
  company,
  count(*)::int                                                                     as postings,
  min(coalesce(nullif(salary_min, 0), salary_max)) filter (where salary_mid is not null) as pay_min,
  max(coalesce(nullif(salary_max, 0), salary_min)) filter (where salary_mid is not null) as pay_max,
  max(posted_date)                                                                  as latest_posted,
  (array_agg(url order by posted_date desc, id desc))[1]                            as url
from public.jobs
where last_seen = (select max(last_seen) from public.jobs)
  and company is not null and company <> ''
group by role_slug, company;

-- Hiring over time, from EVERY job ever seen (not only live ones), by posted_date.
-- period = first day of the week (Monday) or month. Periods with no postings have
-- no row. Periods before stats_meta.first_scrape are incomplete: they only hold
-- jobs that were still listed when scraping began.
create materialized view public.stats_trend as
with j as (
  select a.sector_slug,
         g.granularity,
         date_trunc(g.granularity, a.posted_date::timestamp)::date as period,
         a.salary_mid::float8                                      as mid
  from public.jobs a
  cross join (values ('week'::text), ('month'::text)) as g(granularity)
)
select
  case when grouping(sector_slug) = 1 then 'all' else sector_slug end               as sector_slug,
  granularity,
  period,
  count(*)::int                                                                     as postings,
  round(percentile_cont(0.5) within group (order by mid))::int                      as pay_median
from j
group by grouping sets ((granularity, period, sector_slug), (granularity, period));

-- Unique indexes: they serve the lookups by slug, and REFRESH ... CONCURRENTLY
-- needs one per view. Each matches the view's GROUP BY, so it cannot be violated.
create unique index stats_meta_key         on public.stats_meta (last_scrape);
create unique index stats_sector_key       on public.stats_sector (sector_slug);
create unique index stats_sector_dim_key   on public.stats_sector_dim (sector_slug, dim, name);
create unique index stats_sector_hist_key  on public.stats_sector_hist (sector_slug, bucket_from);
create unique index stats_sector_role_key  on public.stats_sector_role (sector_slug, role_slug);
create unique index stats_sector_exp_key   on public.stats_sector_exp (sector_slug, years_from);
create unique index stats_sector_exp_role_key
  on public.stats_sector_exp_role (sector_slug, years_from, role_slug);
create unique index stats_role_key         on public.stats_role (role_slug);
create unique index stats_role_sector_key  on public.stats_role_sector (role_slug, sector_slug);
create unique index stats_role_dim_key     on public.stats_role_dim (role_slug, dim, name);
create unique index stats_role_company_key on public.stats_role_company (role_slug, company);
create unique index stats_trend_key        on public.stats_trend (sector_slug, granularity, period);

-- The public may read the stats, and only read them.
revoke all on
  public.stats_meta, public.stats_sector, public.stats_sector_dim, public.stats_sector_hist,
  public.stats_sector_role, public.stats_sector_exp, public.stats_sector_exp_role, public.stats_role,
  public.stats_role_sector,
  public.stats_role_dim, public.stats_role_company, public.stats_trend
from anon, authenticated;
grant select on
  public.stats_meta, public.stats_sector, public.stats_sector_dim, public.stats_sector_hist,
  public.stats_sector_role, public.stats_sector_exp, public.stats_sector_exp_role, public.stats_role,
  public.stats_role_sector,
  public.stats_role_dim, public.stats_role_company, public.stats_trend
to anon, service_role;

-- ---------------------------------------------------------------- functions
-- All four are for the scraper. None may be called by anon (see the revokes below).

-- Rebuild every stats view. CONCURRENTLY keeps the old numbers readable while the
-- new ones are computed, and because it is one transaction they all switch together.
-- Security definer: only a view's owner may refresh it.
create or replace function public.refresh_stats()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '15min'
as $$
begin
  refresh materialized view concurrently public.stats_meta;
  refresh materialized view concurrently public.stats_sector;
  refresh materialized view concurrently public.stats_sector_dim;
  refresh materialized view concurrently public.stats_sector_hist;
  refresh materialized view concurrently public.stats_sector_role;
  refresh materialized view concurrently public.stats_sector_exp;
  refresh materialized view concurrently public.stats_sector_exp_role;
  refresh materialized view concurrently public.stats_role;
  refresh materialized view concurrently public.stats_role_sector;
  refresh materialized view concurrently public.stats_role_dim;
  refresh materialized view concurrently public.stats_role_company;
  refresh materialized view concurrently public.stats_trend;
end;
$$;

-- Save today's row for every sector and popular role. Returns the day saved, or
-- NULL when there are no jobs. Running it again for the same day overwrites that
-- day. The scraper calls it only after a full, clean crawl, so a partial day
-- never lands in the history as a false dip.
create or replace function public.snapshot_stats()
returns date
language plpgsql
set search_path = public, pg_temp
as $$
declare
  d date := (select max(last_seen) from public.jobs);
begin
  if d is null then
    return null;
  end if;

  insert into public.history_sector (day, sector_slug, postings, new_postings, companies, pay_median)
  select d,
         case when grouping(sector_slug) = 1 then 'all' else sector_slug end,
         count(*)::int,
         (count(*) filter (where first_seen = d))::int,
         count(distinct company)::int,
         round(percentile_cont(0.5) within group (order by salary_mid::float8))::int
  from public.jobs
  where last_seen = d
  group by grouping sets ((sector_slug), ())
  on conflict (day, sector_slug) do update
    set postings = excluded.postings, new_postings = excluded.new_postings,
        companies = excluded.companies, pay_median = excluded.pay_median;

  delete from public.history_role where day = d;
  insert into public.history_role (day, role_slug, postings, pay_median)
  select d, role_slug, count(*)::int,
         round(percentile_cont(0.5) within group (order by salary_mid::float8))::int
  from public.jobs
  where last_seen = d
  group by role_slug
  having count(*) >= 10;

  return d;
end;
$$;

-- Store what the details pass found:
--   items = [{"id": "...", "min_experience": 3, "vacancies": 2}, ...].
-- A missing or null value leaves that column as it was. Returns how many jobs
-- were updated. (A REST upsert cannot do this: it would try to insert rows that
-- lack the NOT NULL columns.) Replaces the older set_vacancies().
drop function if exists public.set_vacancies(jsonb);
create or replace function public.set_details(items jsonb)
returns integer
language sql
set search_path = public, pg_temp
as $$
  with updated as (
    update public.jobs j
    set min_experience = coalesce(x.min_experience, j.min_experience),
        vacancies      = coalesce(x.vacancies, j.vacancies)
    from jsonb_to_recordset(items) as x(id text, min_experience integer, vacancies integer)
    where j.id = x.id
      and (x.min_experience >= 0 or x.vacancies > 0)
    returning 1
  )
  select count(*)::int from updated;
$$;

-- Optional space saver: clear `raw` on jobs last seen more than keep_days before
-- the latest scrape. The clean columns, and so every statistic, are untouched.
-- Returns how many jobs were cleared. Nothing calls this unless the scraper is
-- run with --prune-raw.
create or replace function public.prune_raw(keep_days integer default 30)
returns integer
language sql
set search_path = public, pg_temp
as $$
  with cleared as (
    update public.jobs
    set raw = null
    where raw is not null
      and last_seen < (select max(last_seen) from public.jobs) - keep_days
    returning 1
  )
  select count(*)::int from cleared;
$$;

revoke all on function public.refresh_stats()      from public, anon, authenticated;
revoke all on function public.snapshot_stats()     from public, anon, authenticated;
revoke all on function public.set_details(jsonb)   from public, anon, authenticated;
revoke all on function public.prune_raw(integer)   from public, anon, authenticated;
grant execute on function public.refresh_stats()      to service_role;
grant execute on function public.snapshot_stats()     to service_role;
grant execute on function public.set_details(jsonb)   to service_role;
grant execute on function public.prune_raw(integer)   to service_role;

-- The REST API cuts service-role requests off after a few seconds by default,
-- which refresh_stats() will outgrow as history builds up. Give the service role
-- room. If this is not permitted on your project the rest of the file still
-- applies; the notice tells you.
do $$
begin
  alter role service_role set statement_timeout = '15min';
exception when others then
  raise notice 'Could not raise the service_role statement timeout (%). If the scraper ever reports that refresh_stats timed out, see the Supabase docs on raising API timeouts.', sqlerrm;
end;
$$;

commit;

-- Tell the REST API about the new objects and settings.
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
