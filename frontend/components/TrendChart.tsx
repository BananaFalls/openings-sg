"use client";

import { useId, useState } from "react";
import { int, niceMax } from "@/lib/format";

export type TrendChartPoint = {
  label: string;
  long: string;
  postings: number;
  partial: boolean;
};

const H = 250;
const M = { t: 26, b: 28 };
const IH = H - M.t - M.b;

/**
 * Postings per week or month. Drawn across in percentages and down in pixels, so it is
 * server-rendered once and stays sharp at any width. The only client-side part is the hover tip.
 */
export function TrendChart({
  list,
  mode,
  peak,
  avg,
}: {
  list: TrendChartPoint[];
  mode: "week" | "month";
  peak: number;
  avg: number;
}) {
  const gid = "ag" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const n = list.length;
  const ymax = niceMax(Math.max(...list.map((b) => b.postings)) * 1.08);
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => M.t + IH - (v / ymax) * IH;
  const pts = list.map((b, i) => [x(i), y(b.postings)] as const);
  const path = (from: number, to: number) =>
    pts
      .slice(from, to + 1)
      .map((p, i) => (i ? "L" : "M") + p[0].toFixed(2) + "," + p[1].toFixed(1))
      .join("");
  // A period that is still running is joined with a dashed line: its count will rise.
  const lastPartial = n > 1 && list[n - 1].partial;
  const solidTo = lastPartial ? n - 2 : n - 1;
  const area = path(0, n - 1) + `L${x(n - 1)},${M.t + IH}L${x(0)},${M.t + IH}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ymax);

  const labels = (every: number, cls: string) => (
    <g className={cls}>
      {list.map((b, i) => {
        const isLast = i === n - 1;
        if (!isLast && (i % every !== 0 || n - 1 - i < every / 2)) return null;
        return (
          <text key={i} x={`${x(i)}%`} y={H - 8} textAnchor={i === 0 ? "start" : isLast ? "end" : "middle"}>
            {b.label}
          </text>
        );
      })}
    </g>
  );

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const f = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };

  const h = hover != null ? list[hover] : null;
  return (
    <div className="chart">
      <div className="plot">
        <svg height={H} role="img" aria-label={`Postings per ${mode}. The numbers are in the table below the chart.`}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.35 }} />
              <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1="0" x2="100%" y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={-8} y={y(t) + 3.5} textAnchor="end">
                {int(t)}
              </text>
            </g>
          ))}
          <svg x="0" y="0" width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
            <path d={area} fill={`url(#${gid})`} />
            {solidTo > 0 ? (
              <path
                d={path(0, solidTo)}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {lastPartial ? (
              <path
                d={path(n - 2, n - 1)}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeDasharray="5 5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          <line x1="0" x2="100%" y1={y(avg)} y2={y(avg)} stroke="var(--muted)" strokeDasharray="4 4" opacity=".7" />
          <text x="100%" y={y(avg) - 6} textAnchor="end">
            avg {int(avg)}
          </text>
          {labels(Math.ceil(n / 12), "only-wide")}
          {labels(Math.ceil(n / 6), "only-narrow")}
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={`${p[0]}%`}
              cy={p[1]}
              r={i === peak ? 5.5 : 2.6}
              fill={i === peak ? "var(--coral)" : list[i].partial ? "var(--bg)" : "var(--accent)"}
              stroke={i === peak ? "var(--bg)" : "var(--accent)"}
              strokeWidth={i === peak ? 2 : list[i].partial ? 1.5 : 0}
            />
          ))}
          {peak >= 0 ? (
            <text
              className="peak"
              x={`${pts[peak][0]}%`}
              y={pts[peak][1] - 12}
              textAnchor={peak === 0 ? "start" : peak === n - 1 ? "end" : "middle"}
            >
              peak
            </text>
          ) : null}
          {hover != null ? (
            <line x1={`${x(hover)}%`} x2={`${x(hover)}%`} y1={M.t} y2={M.t + IH} stroke="var(--ink)" opacity=".25" />
          ) : null}
          <rect
            className="hit"
            x="0"
            y={M.t}
            width="100%"
            height={IH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {h && hover != null ? (
          <div
            className={`tip${x(hover) < 18 ? " left" : x(hover) > 82 ? " right" : ""}`}
            style={{ left: `${x(hover)}%`, top: y(h.postings) }}
          >
            {h.long}
            {h.partial ? " (so far)" : ""}
            <br />
            <b>{int(h.postings)}</b> postings
          </div>
        ) : null}
      </div>
    </div>
  );
}
