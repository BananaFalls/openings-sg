"use client";

import Link from "next/link";
import { useState } from "react";
import { count, int, money, niceMax } from "@/lib/format";
import type { ExperienceBand, ExperienceRole } from "@/lib/types";
import { RangeBar } from "./Bars";

/* A level's pay is shown only when at least this many postings state it. Fewer would be a guess. */
const MIN_LEVEL_PAY = 5;
const SHOWN_ROLES = 12;

type SortKey = "median" | "postings";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const COLS: { key: SortKey; label: string }[] = [
  { key: "postings", label: "Postings" },
  { key: "median", label: "Median" },
];

/** "Up to 2 years", "3 to 5 years", "6 years or more". */
function yearsLabel(from: number, to: number | null) {
  if (to == null) return `${from} ${from === 1 ? "year" : "years"} or more`;
  if (from === 0) return to === 0 ? "No experience asked for" : `Up to ${to} ${to === 1 ? "year" : "years"}`;
  return from === to ? `${from} ${from === 1 ? "year" : "years"}` : `${from} to ${to} years`;
}

/**
 * Advertised pay by the experience a posting asks for. Pressing a level lists the roles
 * offered at that level, which can be sorted by median pay or by postings.
 */
export function ExperiencePay({ sector, levels }: { sector: string; levels: ExperienceBand[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "median", dir: "desc" });
  const [all, setAll] = useState(false);

  const levelPay = (l: ExperienceBand) => ((l.pay?.n ?? 0) >= MIN_LEVEL_PAY ? l.pay : null);
  const levelScale = niceMax(Math.max(0, ...levels.map((l) => levelPay(l)?.p75 ?? 0)) * 1.05);
  const checked = levels.reduce((n, l) => n + l.postings, 0);

  const level = levels.find((l) => l.years_from === open) ?? null;
  const roles: ExperienceRole[] = level && Array.isArray(level.roles) ? level.roles : [];
  const val = (r: ExperienceRole) => (sort.key === "median" ? (r.pay?.median ?? null) : r.postings);
  const sign = sort.dir === "asc" ? 1 : -1;
  const sorted = roles.slice().sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // unknown pay always sorts last
    return sign * (x - y) || b.postings - a.postings || a.role.localeCompare(b.role);
  });
  const shown = all ? sorted : sorted.slice(0, SHOWN_ROLES);
  const roleScale = niceMax(Math.max(0, ...roles.map((r) => r.pay?.p75 ?? 0)) * 1.05);

  const pick = (from: number) => {
    setOpen((o) => (o === from ? null : from));
    setAll(false);
  };
  const press = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div>
      <h2 className="h3">Pay by experience in {sector}</h2>
      <div className="tbl-wrap">
        <table>
          <caption className="vh">
            Advertised pay in {sector} by the experience a posting asks for. Press a level to list its jobs.
          </caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col" className="num">
                Median
              </th>
              <th scope="col">Middle half</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => {
              const p = levelPay(l);
              const isOpen = l.years_from === open;
              return (
                <tr key={l.years_from} className={isOpen ? "picked" : undefined}>
                  <td className="role">
                    <button type="button" className="level-btn" aria-expanded={isOpen} onClick={() => pick(l.years_from)}>
                      {l.level}
                      <span className="arrow" aria-hidden="true">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </button>
                    <span className="sub">
                      {yearsLabel(l.years_from, l.years_to)} · {count(l.postings, "posting", "postings")}
                    </span>
                  </td>
                  <td className="num">{money(p?.median)}</td>
                  <td className="rng">
                    {p?.p25 != null && p.p75 != null ? (
                      <>
                        <RangeBar p25={p.p25} median={p.median} p75={p.p75} scale={levelScale} />
                        <span className="sub">
                          {money(p.p25)} – {money(p.p75)}
                        </span>
                      </>
                    ) : (
                      <span className="sub">Too few postings to say</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {level ? (
        <div className="level-jobs" role="region" aria-label={`${level.level} jobs in ${sector}`}>
          <h3>
            {level.level} jobs in {sector}
          </h3>
          {sorted.length ? (
            <>
              <div className="tbl-wrap">
                <table>
                  <caption className="vh">
                    Roles in {sector} asking for {yearsLabel(level.years_from, level.years_to).toLowerCase()} of
                    experience. Column headers sort the table.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      {COLS.map((c) => (
                        <th
                          key={c.key}
                          scope="col"
                          className="num"
                          aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                        >
                          <button type="button" className="sort-btn" onClick={() => press(c.key)}>
                            {c.label}
                            <span className="arrow" aria-hidden="true">
                              {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                            </span>
                          </button>
                        </th>
                      ))}
                      <th scope="col">Middle half</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.slug}>
                        <td className="role">
                          <Link href={`/roles/${r.slug}`}>{r.role}</Link>
                        </td>
                        <td className="num">{int(r.postings)}</td>
                        <td className="num">{money(r.pay?.median)}</td>
                        <td className="rng">
                          <RangeBar p25={r.pay?.p25} median={r.pay?.median} p75={r.pay?.p75} scale={roleScale} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!all && sorted.length > SHOWN_ROLES ? (
                <button className="btn more-btn" type="button" onClick={() => setAll(true)}>
                  Show all {sorted.length} roles
                </button>
              ) : null}
              <p className="hint">
                Sorted by {sort.key === "median" ? "median pay" : "postings"},{" "}
                {sort.dir === "desc" ? "highest first" : "lowest first"}. With one or two postings, the median is simply
                what those postings advertise. Pick a role to see every company hiring for it.
              </p>
            </>
          ) : (
            <p className="hint">No roles to list for this level yet.</p>
          )}
        </div>
      ) : null}

      <p className="hint">
        Levels go by the least years of experience a posting asks for, not its job title. Press a level to see its
        jobs. Based on {count(checked, "posting", "postings")} we have checked so far, a sample of this sector. The bar
        is the middle half of advertised pay; the tick is the median.
      </p>
    </div>
  );
}
