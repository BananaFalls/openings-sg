// Decisions behind the home page role search box (components/RoleSearch.tsx).
// No imports, so `npm test` (node --test) can run them without a build.

export const MIN_CHARS = 2;

export type SearchState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; q: string; total: number; roles: T[] }
  | { kind: "error" };

/** "  data   analyst " -> "data analyst" */
export function normaliseQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** What the box shows for the text now in it. Results for an earlier query count as still loading,
 *  so they are never shown (or opened with Enter) under the new text. */
export function visibleState<T>(state: SearchState<T>, q: string): SearchState<T> {
  if (q.length < MIN_CHARS) return { kind: "idle" };
  if (state.kind === "done" && state.q !== q) return { kind: "loading" };
  return state;
}

/** Slug that Enter opens: the top result for the current text, or nothing. */
export function enterTarget<T extends { slug: string }>(state: SearchState<T>, q: string): string | undefined {
  const s = visibleState(state, q);
  return s.kind === "done" ? s.roles[0]?.slug : undefined;
}
