import { notFound } from "next/navigation";
import type {
  Meta,
  RoleDetail,
  RoleSummary,
  RolesResponse,
  SectorDetail,
  SectorSummary,
  SectorsResponse,
  Trends,
} from "./types";

/* How often pages ask the API again. The scraper runs once a day. */
export const HOURLY = 3600;
export const DAILY = 86400;

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unconfigured" | "unavailable" | "notfound" };

const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";
const IS_PROD = process.env.NODE_ENV === "production";

function baseUrl(): string | null {
  const raw = (process.env.API_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(path: string, revalidate: number): Promise<Result<T>> {
  const base = baseUrl();
  if (!base) return { ok: false, reason: "unconfigured" };
  const attempts = IS_BUILD ? 3 : 2;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(base + path, {
        headers: { accept: "application/json" },
        next: { revalidate },
        signal: AbortSignal.timeout(IS_BUILD ? 20000 : 10000),
      });
      if (res.status === 404) return { ok: false, reason: "notfound" };
      if (res.ok) {
        const data = (await res.json()) as T;
        if (data && typeof data === "object") return { ok: true, data };
      }
    } catch {
      /* network error, timeout or a body that isn't JSON: try again, then give up quietly */
    }
    if (i < attempts - 1) await sleep(400 * (i + 1));
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * Turns an API result into data, or null when there is none to show.
 *
 * - Unknown slug: the 404 page.
 * - API down or not configured, while building or in development: null, so the page
 *   renders its "live data isn't available right now" state and the build still passes.
 * - API down on the running site: throw. For a page that was already generated, Next.js
 *   keeps serving the last good copy and tries again on a later visit. For a page that
 *   has never been generated, app/error.tsx shows the same kind message. Either way an
 *   empty page never replaces a good one, and nothing is made up.
 */
export function live<T>(result: Result<T>): T | null {
  if (result.ok) return result.data;
  if (result.reason === "notfound") notFound();
  if (IS_PROD && !IS_BUILD) throw new Error("Openings SG API is not available");
  return null;
}

/** Like live(), but never throws: for extras a page can do without (for example the busiest week on a sector page). */
export function optional<T>(result: Result<T>): T | null {
  return result.ok ? result.data : null;
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const getMeta = (revalidate: number) => get<Meta>("/v1/meta", revalidate);

export async function getSectors(revalidate: number): Promise<Result<SectorSummary[]>> {
  const r = await get<SectorsResponse>("/v1/sectors", revalidate);
  return r.ok ? { ok: true, data: arr<SectorSummary>(r.data.sectors) } : r;
}

export const getSector = (slug: string, revalidate: number) =>
  get<SectorDetail>(`/v1/sectors/${encodeURIComponent(slug)}`, revalidate);

export const getRole = (slug: string, revalidate: number) =>
  get<RoleDetail>(`/v1/roles/${encodeURIComponent(slug)}`, revalidate);

export const getTrends = (sectorSlug: string | null, revalidate: number) =>
  get<Trends>(`/v1/trends${sectorSlug ? `?sector=${encodeURIComponent(sectorSlug)}` : ""}`, revalidate);

/** Roles with at least `minPostings` postings, paging until `cap` is reached. */
export async function getRoles(
  minPostings: number,
  cap: number,
  revalidate: number,
): Promise<Result<{ total: number; roles: RoleSummary[] }>> {
  const roles: RoleSummary[] = [];
  let total = 0;
  while (roles.length < cap) {
    const limit = Math.min(1000, cap - roles.length);
    const r = await get<RolesResponse>(
      `/v1/roles?min_postings=${minPostings}&limit=${limit}&offset=${roles.length}`,
      revalidate,
    );
    if (!r.ok) return roles.length ? { ok: true, data: { total, roles } } : r;
    const page = arr<RoleSummary>(r.data.roles);
    total = Number(r.data.total) || roles.length + page.length;
    roles.push(...page);
    if (page.length < limit || roles.length >= total) break;
  }
  return { ok: true, data: { total, roles } };
}

/** Roles whose name contains `q`, most postings first. Includes rare roles: their pages are built on first visit. */
export const searchRoles = (q: string, limit: number, revalidate: number) =>
  get<RolesResponse>(`/v1/roles?min_postings=1&limit=${limit}&q=${encodeURIComponent(q)}`, revalidate);

/** Roles with at least this many postings get a page at build time; the rest are built on first visit. */
export function prerenderMinPostings(): number {
  const n = Number.parseInt(process.env.PRERENDER_MIN_POSTINGS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** True when there is nothing to show: the API gave no answer, or nothing has been scraped yet. */
export const isEmpty = (meta: Meta | null) => !meta || !meta.postings;

/** Slugs are lower-case letters and digits joined by single hyphens ("F&B" -> "f-b"). */
export const looksLikeSlug = (s: string) =>
  s.length <= 160 && /^[\p{Ll}\p{Lo}\p{N}]+(-[\p{Ll}\p{Lo}\p{N}]+)*$/u.test(s);
