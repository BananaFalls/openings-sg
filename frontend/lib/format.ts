export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DASH = "–";
const group = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** S$5,250 (or a dash when the pay is not known). */
export const money = (n: number | null | undefined) => (isNum(n) ? "S$" + group(n) : DASH);

/** S$5.3k, for tight spaces. */
export const kfmt = (n: number | null | undefined) => {
  if (!isNum(n)) return DASH;
  if (n < 1000) return "S$" + Math.round(n);
  return "S$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
};

export const int = (n: number | null | undefined) => (isNum(n) ? group(n) : DASH);

export const plural = (n: number, one: string, many: string) => (Math.round(n) === 1 ? one : many);

/** "5 postings", "1 posting". */
export const count = (n: number | null | undefined, one: string, many: string) =>
  isNum(n) ? `${int(n)} ${plural(n, one, many)}` : `${DASH} ${many}`;

export function niceMax(v: number) {
  if (!(v > 0)) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const SGT = 8 * 3600 * 1000;

/** Parses an ISO date or date-time. Date-times are shifted to Singapore time; read the result with UTC getters. */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const s = String(iso).trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (day) return new Date(Date.UTC(+day[1], +day[2] - 1, +day[3]));
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const t = Date.parse(hasZone ? s : s.replace(" ", "T") + "Z");
  return Number.isNaN(t) ? null : new Date(t + SGT);
}

/** 13 Oct 2026 */
export function fmtDate(iso: string | null | undefined): string | null {
  const d = parseDate(iso);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : null;
}

/** 2026-10-13, for <time datetime>. */
export function isoDay(iso: string | null | undefined): string | undefined {
  const d = parseDate(iso);
  return d ? d.toISOString().slice(0, 10) : undefined;
}

/** A CSS percentage, clamped to 0-100. */
export const pct = (v: number, digits = 2) => `${Math.max(0, Math.min(100, v)).toFixed(digits)}%`;
