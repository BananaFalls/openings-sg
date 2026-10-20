"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { int, kfmt } from "@/lib/format";
import { MIN_CHARS, enterTarget, normaliseQuery, visibleState, type SearchState } from "@/lib/search";
import type { RoleHit } from "@/app/api/roles/route";

type State = SearchState<RoleHit>;

/** "Type your job title" box for the home page. Results link straight to the role pages. */
export function RoleSearch() {
  const id = useId();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const q = normaliseQuery(query);

  useEffect(() => {
    if (q.length < MIN_CHARS) return;
    const ctl = new AbortController();
    // wait for a pause in typing, so each keystroke isn't a request
    const timer = setTimeout(async () => {
      setState((s) => (s.kind === "done" ? s : { kind: "loading" }));
      try {
        const res = await fetch(`/api/roles?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { total?: number; roles?: RoleHit[] };
        const roles = Array.isArray(body.roles) ? body.roles : [];
        setState({ kind: "done", q, total: Number(body.total) || roles.length, roles });
      } catch {
        if (!ctl.signal.aborted) setState({ kind: "error" });
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);

  // results always belong to the text now in the box: an earlier query's rows are never shown or opened
  const shown = visibleState(state, q);
  const target = enterTarget(state, q);

  return (
    <form
      className="role-search"
      role="search"
      action="/sectors"
      onSubmit={(e) => {
        e.preventDefault();
        if (target) router.push(`/roles/${target}`);
      }}
    >
      <label htmlFor={id}>What job are you looking for?</label>
      <input
        id={id}
        type="search"
        name="q"
        autoComplete="off"
        spellCheck={false}
        placeholder="Try “data analyst” or “nurse”"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-describedby={`${id}-status`}
      />
      <div id={`${id}-status`} role="status" className="rs-status">
        {shown.kind === "loading" ? "Searching…" : null}
        {shown.kind === "error" ? (
          <>
            Search isn&rsquo;t working right now. You can still <Link href="/sectors#roles">browse roles by sector</Link>.
          </>
        ) : null}
        {shown.kind === "done" && !shown.roles.length ? (
          <>
            No roles match &ldquo;{shown.q}&rdquo;. Try a shorter word, or <Link href="/sectors">browse by sector</Link>.
          </>
        ) : null}
        {shown.kind === "done" && shown.roles.length ? (
          <span className="vh">
            {shown.total > shown.roles.length
              ? `Showing the top ${shown.roles.length} of ${int(shown.total)} matching roles.`
              : `${shown.roles.length} matching ${shown.roles.length === 1 ? "role" : "roles"}.`}
          </span>
        ) : null}
      </div>
      {shown.kind === "done" && shown.roles.length ? (
        <div className="rs-results">
          <div className="t-head" aria-hidden="true">
            <span>Role</span>
            <span>Postings</span>
            <span>Median pay</span>
          </div>
          {shown.roles.map((r) => (
            <Link className="t-row" href={`/roles/${r.slug}`} key={r.slug}>
              <span className="n">
                {r.role}
                {r.sector ? <span className="rs-sector"> · {r.sector}</span> : null}
              </span>
              <span className="o">
                {int(r.postings)}
                <span className="vh"> postings,</span>
              </span>
              <span className="p">
                {kfmt(r.median)}
                <span className="vh"> median monthly pay</span>
              </span>
            </Link>
          ))}
          {shown.total > shown.roles.length ? (
            <p className="rs-more">
              Top {shown.roles.length} of {int(shown.total)} matches. Keep typing to narrow it down.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
