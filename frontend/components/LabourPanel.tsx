import { LABOUR, LABOUR_SOURCES } from "@/lib/labour";
import { LabourChart } from "./Charts";

/** Singapore labour market panel. Official MOM figures only; the caveats stay visible next to the chart. */
export function LabourPanel() {
  const full = LABOUR.filter((r) => r.underemployment != null).map((r) => ({
    year: r.year,
    tot: +(r.unemployment + (r.underemployment as number)).toFixed(1),
  }));
  const peak = full.reduce((a, b) => (b.tot > a.tot ? b : a));
  const low = full.reduce((a, b) => (b.tot < a.tot ? b : a));
  const lastFull = full[full.length - 1];
  const latest = LABOUR[LABOUR.length - 1];
  const before = LABOUR[LABOUR.length - 2];
  const rose = latest.unemployment > before.unemployment;
  const same = latest.unemployment === before.unemployment;
  const pending = latest.underemployment == null;

  return (
    <section className="panel glass" aria-labelledby="u6Title">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Singapore labour market</div>
          <h2 id="u6Title">Broad underutilisation rate (U-6 style)</h2>
          <p className="hint">
            Residents who are unemployed, plus part-timers who want more hours but can&rsquo;t get them. Singapore
            doesn&rsquo;t publish an official U-6, so this adds MOM&rsquo;s two June survey rates together.
          </p>
        </div>
        <div className="legend">
          <span>
            <i className="sw-coral" />
            Unemployment
          </span>
          <span>
            <i className="sw-sky" />
            Time-related underemployment
          </span>
        </div>
      </div>
      <div className="season">
        <LabourChart />
        <div className="insights">
          <div className="insight">
            <div className="label">Latest full year</div>
            <div className="big">{lastFull.tot.toFixed(1)}%</div>
            <div className="note">
              June {lastFull.year}
              {low.year === lastFull.year ? ", the lowest in this series" : ""}. Down from {peak.tot.toFixed(1)}% at the{" "}
              {peak.year} COVID peak.
            </div>
          </div>
          <div className="insight">
            <div className="label">Unemployment, June {latest.year}</div>
            <div className="big">
              {latest.unemployment}%{" "}
              {same ? null : (
                <span className={`delta ${rose ? "down" : "up"}`}>
                  {rose ? "▲" : "▼"} {Math.abs(latest.unemployment - before.unemployment).toFixed(1)} pts
                </span>
              )}
            </div>
            <div className="note">
              Residents, seasonally adjusted.
              {pending ? ` Underemployment for ${latest.year} is due in MOM’s year-end release.` : ""}
            </div>
          </div>
        </div>
      </div>
      <p className="small src">
        Sources:{" "}
        <a href={LABOUR_SOURCES.unemployment.href} target="_blank" rel="noopener">
          {LABOUR_SOURCES.unemployment.label}
        </a>{" "}
        · MOM Labour Force in Singapore advance releases{" "}
        {LABOUR_SOURCES.underemployment.map((s, i) => (
          <span key={s.label}>
            {i ? ", " : ""}
            <a href={s.href} target="_blank" rel="noopener">
              {s.label}
            </a>
          </span>
        ))}
        . The two rates use slightly different bases (labour force vs employed), so the total is an approximation.
        {pending ? ` *${latest.year} shows unemployment only; underemployment is not yet published.` : ""}
      </p>
    </section>
  );
}
