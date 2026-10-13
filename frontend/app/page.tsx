import type { Metadata } from "next";
import Link from "next/link";
import { Sparkline } from "@/components/Charts";
import { HashRedirect } from "@/components/HashRedirect";
import { LabourPanel } from "@/components/LabourPanel";
import { DataFoot, Stamp, Unavailable } from "@/components/Notes";
import { getMeta, getSectors, getTrends, HOURLY, isEmpty, live } from "@/lib/api";
import { fmtDate, int, kfmt, money } from "@/lib/format";
import { TAGLINE } from "@/lib/site";
import { historySpan, trendView } from "@/lib/trends";

export const revalidate = 3600;

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function OverviewPage() {
  const [metaR, sectorsR, trendsR] = await Promise.all([getMeta(HOURLY), getSectors(HOURLY), getTrends(null, HOURLY)]);
  const meta = live(metaR);
  const sectors = live(sectorsR);
  const trends = live(trendsR);
  const ok = !isEmpty(meta) && !!sectors && sectors.length > 0;

  const top = ok ? sectors.slice().sort((a, b) => b.postings - a.postings) : [];
  const view = trendView(ok ? trends : null, meta?.first_scrape, meta?.last_scrape);
  const done = view.list.filter((b) => !b.partial);
  const peak = view.peak >= 0 ? view.list[view.peak] : null;
  const span = historySpan(meta?.first_scrape, meta?.last_scrape);
  const since = fmtDate(meta?.first_scrape);
  const payShare = typeof meta?.pay_coverage === "number" ? Math.round(meta.pay_coverage * 100) : null;

  return (
    <main id="main" className="view">
      <HashRedirect />
      <section className="hero">
        <div>
          <p className="tagline">{TAGLINE}</p>
          <h1>Find where Singapore is hiring, and what it pays.</h1>
          <p className="lede">
            Job postings and advertised monthly salaries by sector and role from MyCareersFuture, plus when employers post
            the most jobs.
          </p>
          <Stamp meta={ok ? meta : null} />
        </div>
        {ok && meta ? (
          <div className="hero-data">
            <div className="kpis">
              <div className="kpi glass">
                <span className="label">Job postings</span>
                <span className="val">{int(meta.postings)}</span>
                <span className="sub">live on MyCareersFuture · {sectors.length} sectors</span>
              </div>
              <div className="kpi glass">
                <span className="label">Companies hiring</span>
                <span className="val">{int(meta.companies)}</span>
                <span className="sub">with at least one live posting</span>
              </div>
              <div className="kpi glass">
                <span className="label">Median monthly pay</span>
                <span className="val">{money(meta.median_pay)}</span>
                <span className="sub">
                  midpoint of advertised range{payShare != null ? ` · ${payShare}% of postings state pay` : ""}
                </span>
              </div>
              <div className="kpi glass small">
                <span className="label">Most postings</span>
                <span className="val">
                  <Link href={`/sectors/${top[0].slug}`}>{top[0].sector}</Link>
                </span>
                <span className="sub">{int(top[0].postings)} postings</span>
              </div>
            </div>
          </div>
        ) : (
          <Unavailable empty={!!meta && isEmpty(meta)} />
        )}
      </section>

      <section className="teasers" aria-label="Explore">
        <Link className="teaser glass" href="/season">
          <span className="eyebrow">Hiring season</span>
          {ok && peak && done.length >= 2 ? (
            <>
              <span className="t-big">{peak.long}</span>
              <span className="t-note">
                Busiest {view.mode} for new postings so far
                {span ? `, from ${span} of data` : ""}.
              </span>
              <Sparkline values={view.list.map((b) => b.postings)} peak={view.peak} />
            </>
          ) : ok ? (
            <>
              <span className="t-big">Building history</span>
              <span className="t-note">
                {since ? `We started collecting postings on ${since}. ` : ""}A trend needs a few weeks of data, so
                there isn&rsquo;t one to show yet.
              </span>
            </>
          ) : (
            <>
              <span className="t-big sm">When employers post the most jobs</span>
              <span className="t-note">The hiring trend will show here once live data is back.</span>
            </>
          )}
          <span className="t-go">See the full trend →</span>
        </Link>

        <div className="teaser glass">
          <span className="eyebrow">Top sectors right now</span>
          {ok ? (
            <div className="t-list">
              <div className="t-head" aria-hidden="true">
                <span>Sector</span>
                <span>Postings</span>
                <span>Median pay</span>
              </div>
              {top.slice(0, 5).map((s) => (
                <Link className="t-row" href={`/sectors/${s.slug}`} key={s.slug}>
                  <span className="n">{s.sector}</span>
                  <span className="o">
                    {int(s.postings)}
                    <span className="vh"> postings,</span>
                  </span>
                  <span className="p">
                    {kfmt(s.pay?.median)}
                    <span className="vh"> median monthly pay</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <span className="t-note">Sector figures will show here once live data is back.</span>
          )}
          <Link className="t-go" href="/sectors">
            Compare all sectors and roles →
          </Link>
        </div>

        <div className="teaser glass">
          <span className="eyebrow">Who&rsquo;s behind this</span>
          <span className="t-big sm">An engineer who&rsquo;s job hunting too.</span>
          <span className="t-note">Free, no ads, no sign-up. Built from the same job search you&rsquo;re on.</span>
          <span className="t-links">
            <Link className="t-go" href="/about">
              Read the story →
            </Link>
            <Link className="t-go" href="/about#kopi">
              Buy me a kopi →
            </Link>
          </span>
        </div>
      </section>

      <LabourPanel />
      <DataFoot meta={ok ? meta : null} />
    </main>
  );
}
