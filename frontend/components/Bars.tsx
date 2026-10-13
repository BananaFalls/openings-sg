import Link from "next/link";
import { money, pct } from "@/lib/format";

/** Middle half of advertised pay (25th to 75th percentile) with a tick at the median. */
export function RangeBar({
  p25,
  median,
  p75,
  scale,
}: {
  p25: number | null | undefined;
  median: number | null | undefined;
  p75: number | null | undefined;
  scale: number;
}) {
  if (p25 == null || p75 == null || !(scale > 0)) return <div className="range" />;
  const left = (p25 / scale) * 100;
  const right = (p75 / scale) * 100;
  const label = `${money(p25)} – ${money(p75)}${median != null ? `, median ${money(median)}` : ""}`;
  return (
    <div className="range" title={label} role="img" aria-label={`Middle half of advertised pay: ${label}`}>
      <span style={{ left: pct(left), width: pct(Math.max(0, right - left)) }} />
      {median != null ? <i style={{ left: pct((median / scale) * 100) }} /> : null}
    </div>
  );
}

/** A lowest-to-highest advertised range for one company. */
export function SpanBar({ lo, hi, scale }: { lo: number; hi: number; scale: number }) {
  if (!(scale > 0)) return null;
  const left = (lo / scale) * 100;
  return (
    <div className="range" aria-hidden="true">
      <span style={{ left: pct(left), width: pct(Math.max(1, (hi / scale) * 100 - left)) }} />
    </div>
  );
}

/** Share bars, biggest first: employment type, seniority, sectors. Shares are of postings. */
export function ShareBars({
  items,
  empty,
}: {
  items: { name: string; postings: number; href?: string }[];
  empty: string;
}) {
  const clean = (Array.isArray(items) ? items : []).filter((i) => i && i.postings > 0);
  const total = clean.reduce((s, i) => s + i.postings, 0);
  if (!total) return <p className="hint">{empty}</p>;
  const top = clean.slice().sort((a, b) => b.postings - a.postings).slice(0, 6);
  return (
    <div className="bars">
      {top.map((i) => {
        const share = (i.postings / total) * 100;
        return (
          <div className="bar-row" key={i.name}>
            <span>{i.href ? <Link href={i.href}>{i.name}</Link> : i.name}</span>
            <div className="track">
              <div className="fill" style={{ width: pct(share) }} />
            </div>
            <span className="pct">{share.toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}
