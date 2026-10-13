import { int, kfmt, niceMax } from "@/lib/format";
import { LABOUR } from "@/lib/labour";
import type { HistogramBin } from "@/lib/types";

/*
 * Server-rendered SVG charts, ported from the hand-drawn charts in web/index.html.
 * No chart library. Across is in percentages, down is in pixels, so one piece of markup
 * fits every width with text at its real size. Colours come from the design tokens.
 */

/** Small trend line for the overview teaser. */
export function Sparkline({ values, peak }: { values: number[]; peak: number }) {
  const n = values.length;
  const mx = Math.max(...values);
  if (n < 2 || !(mx > 0)) return null;
  const H = 70;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => H - 6 - (v / mx) * (H - 16);
  const d = values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(2) + "," + y(v).toFixed(1)).join("");
  return (
    <span className="spark">
      <svg height={H} aria-hidden="true">
        <svg x="0" y="0" width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
          <path d={`${d}L100,${H}L0,${H}Z`} fill="var(--accent-soft)" />
          <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        </svg>
        {peak >= 0 ? <circle cx={`${Math.min(98.5, Math.max(1.5, x(peak)))}%`} cy={y(values[peak])} r="4" fill="var(--coral)" /> : null}
      </svg>
    </span>
  );
}

/** U-6 style chart: resident unemployment with time-related underemployment stacked on top. Official MOM figures. */
export function LabourChart() {
  const H = 260;
  const m = { t: 22, b: 28 };
  const ih = H - m.t - m.b;
  const ymax = 10;
  const n = LABOUR.length;
  const slot = 100 / n;
  const bw = slot * 0.62;
  const y = (v: number) => m.t + ih - (v / ymax) * ih;
  const first = LABOUR[0].year;
  const last = LABOUR[n - 1].year;
  return (
    <div className="chart">
      <div className="plot tight">
        <svg
          height={H}
          role="img"
          aria-label={`Resident unemployment plus time-related underemployment, ${first} to ${last}`}
        >
          {[0, 2, 4, 6, 8, 10].map((t) => (
            <g key={t}>
              <line x1="0" x2="100%" y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={-6} y={y(t) + 3.5} textAnchor="end">
                {t}%
              </text>
            </g>
          ))}
          {LABOUR.map(({ year, unemployment: u, underemployment: ue }, i) => {
            const cx = slot * i + slot / 2;
            const x0 = cx - bw / 2;
            const tot = ue == null ? null : +(u + ue).toFixed(1);
            const tip =
              `${year}: unemployment ${u}%` +
              (ue == null || tot == null
                ? ", underemployment not yet published"
                : `, underemployment ${ue}%, total ${tot}%`);
            return (
              <g key={year}>
                <title>{tip}</title>
                <rect x={`${x0}%`} y={y(u)} width={`${bw}%`} height={y(0) - y(u)} rx="3" fill="var(--coral)" />
                {ue == null ? null : (
                  <rect
                    x={`${x0}%`}
                    y={y(u + ue)}
                    width={`${bw}%`}
                    height={Math.max(0, y(u) - y(u + ue) - 2)}
                    rx="3"
                    fill="var(--sky)"
                  />
                )}
                <text
                  className={tot == null ? undefined : "strong"}
                  x={`${cx}%`}
                  y={(tot == null ? y(u) : y(tot)) - 6}
                  textAnchor="middle"
                >
                  {tot == null ? u.toFixed(1) + "*" : tot.toFixed(1)}
                </text>
                <text x={`${cx}%`} y={H - 8} textAnchor="middle">
                  <tspan className="only-wide">{year}</tspan>
                  <tspan className="only-narrow">{"’" + String(year).slice(2)}</tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Postings by monthly pay midpoint. The bright bar holds the median. Bins come straight from the API. */
export function Histogram({ bins, median }: { bins: HistogramBin[]; median: number | null | undefined }) {
  const list = (Array.isArray(bins) ? bins : []).filter((b) => b && typeof b.count === "number");
  const max = list.length ? Math.max(...list.map((b) => b.count)) : 0;
  if (!(max > 0)) return null;
  const H = 190;
  const m = { t: 14, b: 26 };
  const ih = H - m.t - m.b;
  const n = list.length;
  const slot = 100 / n;
  const ymax = niceMax(max);
  const lastBin = list[n - 1];
  // The last bucket also holds everything above it, so it reads "X or more", never "from-to".
  const holdsMedian = (b: HistogramBin) =>
    median != null && b.from != null && b.from <= median && (b === lastBin || b.to == null || median < b.to);
  const range = (b: HistogramBin) =>
    b === lastBin || b.to == null
      ? `${kfmt(b.from)} or more`
      : b.from == null
        ? `under ${kfmt(b.to)}`
        : `${kfmt(b.from)}–${kfmt(b.to)}`;
  const labels = (every: number, cls: string) => (
    <g className={cls}>
      {list.map((b, i) =>
        i % every === 0 && b.from != null && i < n - 1 && n - i > every / 2 ? (
          <text key={i} x={`${i * slot}%`} y={H - 8} textAnchor={i === 0 ? "start" : "middle"}>
            {kfmt(b.from)}
          </text>
        ) : null,
      )}
    </g>
  );
  return (
    <div className="chart">
      <div className="plot tight">
        <svg height={H} role="img" aria-label="Postings by advertised monthly pay">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1="0" x2="100%" y1={m.t + ih - f * ih} y2={m.t + ih - f * ih} stroke="var(--line)" />
              <text x={-6} y={m.t + ih - f * ih + 3.5} textAnchor="end">
                {int(f * ymax)}
              </text>
            </g>
          ))}
          {list.map((b, i) => (
            <rect
              key={i}
              x={`${i * slot + slot * 0.07}%`}
              y={m.t + ih - (b.count / ymax) * ih}
              width={`${slot * 0.86}%`}
              height={(b.count / ymax) * ih}
              rx="3"
              fill="var(--accent)"
              opacity={holdsMedian(b) ? 1 : 0.55}
            >
              <title>{`${range(b)}: ${int(b.count)} postings`}</title>
            </rect>
          ))}
          {labels(Math.ceil(n / 8), "only-wide")}
          {labels(Math.ceil(n / 5), "only-narrow")}
          <text x="100%" y={H - 8} textAnchor="end">
            {kfmt(lastBin.from)}+
          </text>
        </svg>
      </div>
    </div>
  );
}
