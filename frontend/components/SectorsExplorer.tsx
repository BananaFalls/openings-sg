"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { int, money, niceMax } from "@/lib/format";
import type { SectorSummary } from "@/lib/types";
import { RangeBar } from "./Bars";

export type RoleRow = {
  role: string;
  slug: string;
  postings: number;
  median: number | null;
  sector: string | null;
  sectorSlug: string | null;
};

type SortKey = "sector" | "postings" | "companies" | "median";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const COLS: { key: SortKey; label: string; num: boolean }[] = [
  { key: "sector", label: "Sector", num: false },
  { key: "postings", label: "Postings", num: true },
  { key: "companies", label: "Companies", num: true },
  { key: "median", label: "Median pay", num: true },
];

const ROLE_LIMIT = 30;

/** Sortable, searchable sectors table, plus the roles that match the search. */
export function SectorsExplorer({
  sectors,
  roles,
  roleMin,
}: {
  sectors: SectorSummary[];
  roles: RoleRow[];
  /** Roles in the list have at least this many postings. */
  roleMin: number;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "postings", dir: "desc" });
  const [allRoles, setAllRoles] = useState(false);
  const q = query.trim().toLowerCase();

  const scale = useMemo(() => niceMax(Math.max(0, ...sectors.map((s) => s.pay?.p75 ?? 0)) * 1.05), [sectors]);

  const roleHits = useMemo(() => (q ? roles.filter((r) => r.role.toLowerCase().includes(q)) : roles), [q, roles]);

  const rows = useMemo(() => {
    const hitSectors = new Set(q ? roleHits.map((r) => r.sectorSlug) : []);
    const list = sectors.filter((s) => !q || s.sector.toLowerCase().includes(q) || hitSectors.has(s.slug));
    const val = (s: SectorSummary) =>
      sort.key === "sector" ? s.sector : sort.key === "median" ? (s.pay?.median ?? null) : s[sort.key];
    const sign = sort.dir === "asc" ? 1 : -1;
    return list.slice().sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // unknown pay always sorts last
      if (y == null) return -1;
      return typeof x === "string" || typeof y === "string"
        ? sign * String(x).localeCompare(String(y))
        : sign * (x - y);
    });
  }, [sectors, roleHits, q, sort]);

  const press = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "sector" ? "asc" : "desc" }));

  const shownRoles = allRoles || q ? roleHits.slice(0, 200) : roleHits.slice(0, ROLE_LIMIT);

  return (
    <>
      <div className="controls" style={{ marginBottom: 14 }}>
        <input
          type="search"
          placeholder="Search sectors or roles"
          aria-label="Search sectors or roles"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="small" role="status">
          {q
            ? `${rows.length} ${rows.length === 1 ? "sector" : "sectors"} and ${roleHits.length} ${roleHits.length === 1 ? "role" : "roles"} match`
            : `${sectors.length} sectors`}
        </span>
      </div>

      {rows.length ? (
        <div className="tbl-wrap">
          <table>
            <caption className="vh">Postings and advertised pay by sector. Column headers sort the table.</caption>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.num ? "num" : undefined}
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
                <th scope="col">Middle half of pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const match = q && !s.sector.toLowerCase().includes(q) ? roleHits.find((r) => r.sectorSlug === s.slug) : null;
                return (
                  <tr key={s.slug}>
                    <td className="role">
                      <Link href={`/sectors/${s.slug}`}>{s.sector}</Link>
                      {match ? <span className="sub">Matches · {match.role}</span> : null}
                    </td>
                    <td className="num">{int(s.postings)}</td>
                    <td className="num">{int(s.companies)}</td>
                    <td className="num">{money(s.pay?.median)}</td>
                    <td className="rng">
                      <RangeBar p25={s.pay?.p25} median={s.pay?.median} p75={s.pay?.p75} scale={scale} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hint">No sectors match &ldquo;{query}&rdquo;.</p>
      )}

      <div id="roles" style={{ marginTop: 26, scrollMarginTop: 84 }}>
        <h2>{q ? "Roles that match" : "Roles with the most postings"}</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          Pick a role to see its pay and which companies are hiring.
          {roleMin > 1 ? ` This list has roles with ${roleMin} or more postings.` : ""}
        </p>
        {shownRoles.length ? (
          <div className="tbl-wrap">
            <table>
              <caption className="vh">Roles, with postings and median advertised pay</caption>
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col" className="num">
                    Postings
                  </th>
                  <th scope="col" className="num">
                    Median pay
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownRoles.map((r) => (
                  <tr key={r.slug}>
                    <td className="role">
                      <Link href={`/roles/${r.slug}`}>{r.role}</Link>
                      {r.sector ? <span className="sub">Mostly in {r.sector}</span> : null}
                    </td>
                    <td className="num">{int(r.postings)}</td>
                    <td className="num">{money(r.median)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">
            {roles.length ? <>No roles match &ldquo;{query}&rdquo;.</> : "No roles to list yet."}
          </p>
        )}
        {!q && !allRoles && roleHits.length > ROLE_LIMIT ? (
          <button className="btn more-btn" type="button" onClick={() => setAllRoles(true)}>
            Show {Math.min(200, roleHits.length) === roleHits.length ? `all ${int(roleHits.length)}` : "200"} roles
          </button>
        ) : null}
        {(q || allRoles) && roleHits.length > 200 ? (
          <p className="hint">Showing the first 200. Search to narrow it down.</p>
        ) : null}
      </div>
    </>
  );
}
