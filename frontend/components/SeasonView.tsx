import Link from "next/link";
import { fmtDate, int, money, MONTHS_LONG } from "@/lib/format";
import { historySpan, trendView, type TrendView } from "@/lib/trends";
import type { Meta, SectorSummary, Trends } from "@/lib/types";
import { Stamp, Unavailable, VacancyNote } from "./Notes";
import { SectorPicker } from "./SectorPicker";
import { TrendChart } from "./TrendChart";

function Insights({ view }: { view: TrendView }) {
  const { list, mode, peak, avg } = view;
  const done = list.filter((b) => !b.partial);
  const last = list[list.length - 1];
  const prev = list[list.length - 2];
  const p = peak >= 0 ? list[peak] : null;
  const above = p && avg > 0 ? Math.round((p.openings / avg - 1) * 100) : null;
  const chg = !last.partial && prev && prev.openings ? ((last.openings - prev.openings) / prev.openings) * 100 : null;

  // "Best months" needs every calendar month at least once. With less, we say so instead of guessing.
  let best: number[] | null = null;
  if (mode === "month" && done.length >= 12) {
    const byMonth = new Map<number, number[]>();
    for (const b of done) if (b.month != null) byMonth.set(b.month, [...(byMonth.get(b.month) ?? []), b.openings]);
    if (byMonth.size === 12) {
      best = [...byMonth.entries()]
        .map(([mo, a]) => [mo, a.reduce((s, v) => s + v, 0) / a.length] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([mo]) => mo);
    }
  }

  return (
    <div className="insights">
      {p ? (
        <div className="insight">
          <div className="label">Busiest {mode} so far</div>
          <div className="big">{p.long}</div>
          <div className="note">
            {int(p.openings)} openings
            {done.length >= 3 && above != null && above > 0
              ? `, ${above}% above the ${mode}ly average`
              : `, out of the ${done.length} ${mode}${done.length === 1 ? "" : "s"} we have`}
          </div>
        </div>
      ) : null}
      <div className="insight">
        <div className="label">Latest {mode}</div>
        <div className="big">
          {int(last.openings)}{" "}
          {chg != null ? (
            <span className={`delta ${chg >= 0 ? "up" : "down"}`}>
              {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(0)}%
            </span>
          ) : last.partial ? (
            <span className="delta">so far</span>
          ) : null}
        </div>
        <div className="note">
          {last.partial
            ? `${last.long}. This ${mode} isn’t over, so the number will rise.`
            : prev
              ? `${last.long} vs ${prev.long}`
              : last.long}
        </div>
      </div>
      <div className="insight">
        <div className="label">Best months to apply</div>
        {best ? (
          <>
            <div className="chips">
              {best.map((mo) => (
                <span className="chip" key={mo}>
                  {MONTHS_LONG[mo]}
                </span>
              ))}
            </div>
            <div className="note" style={{ marginTop: 6 }}>
              Months with the most new openings.
            </div>
          </>
        ) : (
          <div className="note">
            Too early to say. We need a full year of postings before we can tell you which months are busiest, and we
            won&rsquo;t guess.
          </div>
        )}
      </div>
    </div>
  );
}

/** The hiring season panel, for all sectors or one. Shows only the periods the API has; nothing is padded. */
export function SeasonView({
  meta,
  sectors,
  trends,
  current,
}: {
  meta: Meta | null;
  sectors: SectorSummary[] | null;
  trends: Trends | null;
  current: SectorSummary | null;
}) {
  const view = trendView(trends, meta?.first_scrape, meta?.last_scrape);
  const ok = !!meta && !!meta.postings && !!trends;
  const span = historySpan(meta?.first_scrape, meta?.last_scrape);
  const since = fmtDate(meta?.first_scrape);
  const unit = view.mode;

  return (
    <section className="panel glass" aria-labelledby="seasonTitle">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Hiring season{current ? ` · ${current.sector}` : ""}</div>
          <h1 className="dd-title" id="seasonTitle">
            {current ? `When ${current.sector} employers post the most openings` : "When employers post the most openings"}
          </h1>
          {ok ? <Stamp meta={meta} /> : null}
        </div>
        {sectors && sectors.length ? (
          <div className="controls">
            <SectorPicker
              sectors={sectors.map((s) => ({ sector: s.sector, slug: s.slug }))}
              current={current?.slug ?? ""}
              base="/season"
              label="Sector for hiring trend"
              allLabel="All sectors"
            />
          </div>
        ) : null}
      </div>

      {!ok ? (
        <Unavailable empty={!!meta && !meta.postings} />
      ) : view.list.length < 2 ? (
        <p className="hint">
          Not enough history to draw a trend yet.{" "}
          {since ? `We started collecting postings on ${since}. ` : ""}
          Come back in a few weeks and this chart will have something real to show.
        </p>
      ) : (
        <>
          <div className="season">
            <TrendChart
              list={view.list.map((b) => ({
                label: b.label,
                long: b.long,
                openings: b.openings,
                postings: b.postings,
                partial: b.partial,
              }))}
              mode={view.mode}
              peak={view.peak}
              avg={view.avg}
            />
            <Insights view={view} />
          </div>
          <p className="note-box" style={{ marginTop: 16 }}>
            <strong>
              {span ? `This is ${span} of data, not a full picture yet.` : "This is a short history, not a full picture yet."}
            </strong>{" "}
            {since ? `We started collecting postings on ${since}. ` : ""}
            Older postings are left out: we only saw the ones that were still open that day, so counting them would
            make earlier {unit}s look quieter than they were.{" "}
            The chart shows what we have and grows every day.
          </p>
          <div style={{ marginTop: 10 }}>
            <VacancyNote meta={meta} />
          </div>
          <details className="numbers">
            <summary>Show the numbers</summary>
            <div className="tbl-wrap">
              <table>
                <caption className="vh">Openings and postings per {unit}</caption>
                <thead>
                  <tr>
                    <th scope="col">{unit === "week" ? "Week" : "Month"}</th>
                    <th scope="col" className="num">
                      Openings
                    </th>
                    <th scope="col" className="num">
                      Postings
                    </th>
                    <th scope="col" className="num">
                      Median pay
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.list.map((b, i) => (
                    <tr key={i}>
                      <td>
                        {b.long}
                        {b.partial ? " (so far)" : ""}
                      </td>
                      <td className="num">{int(b.openings)}</td>
                      <td className="num">{int(b.postings)}</td>
                      <td className="num">{money(b.medianPay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {current ? (
        <p className="hint" style={{ marginTop: 14 }}>
          <Link href={`/sectors/${current.slug}`}>See pay and roles in {current.sector} →</Link>
        </p>
      ) : null}
    </section>
  );
}
