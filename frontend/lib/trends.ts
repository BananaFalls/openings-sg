import { MONTHS, MONTHS_LONG, parseDate } from "./format";
import type { TrendPoint, Trends } from "./types";

export type Bucket = {
  /** Short axis label: "6 Oct" or "Oct '26". */
  label: string;
  /** Full label: "Week of 6 Oct 2026" or "October 2026". */
  long: string;
  openings: number;
  postings: number;
  medianPay: number | null;
  /** Calendar month 0-11, when known. */
  month: number | null;
  /** First day of the period, UTC ms, when the period could be read. */
  start: number | null;
  /** The period is still running, so its counts will rise. */
  partial: boolean;
};

export type TrendView = {
  mode: "week" | "month";
  list: Bucket[];
  /** Index of the busiest period, or -1. */
  peak: number;
  avg: number;
};

const DAY = 864e5;

function startOf(period: string, mode: "week" | "month"): number | null {
  const s = String(period).trim();
  const isoWeek = /^(\d{4})-?W(\d{1,2})$/i.exec(s);
  if (isoWeek) {
    // Monday of ISO week n
    const jan4 = Date.UTC(+isoWeek[1], 0, 4);
    const dow = (new Date(jan4).getUTCDay() + 6) % 7;
    return jan4 - dow * DAY + (+isoWeek[2] - 1) * 7 * DAY;
  }
  const ym = /^(\d{4})-(\d{2})$/.exec(s);
  if (ym) return Date.UTC(+ym[1], +ym[2] - 1, 1);
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) return mode === "month" ? Date.UTC(+ymd[1], +ymd[2] - 1, 1) : Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3]);
  return null;
}

/** Start of the week (Monday) or month that holds a date. */
function periodStart(t: number, mode: "week" | "month"): number {
  const d = new Date(t);
  if (mode === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day - ((d.getUTCDay() + 6) % 7) * DAY;
}

const nextStart = (t: number, mode: "week" | "month") => {
  const d = new Date(t);
  return mode === "week" ? t + 7 * DAY : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};

/**
 * Shapes API trend points for the charts.
 *
 * - The API leaves out periods with no postings. Those gaps are real zeros, so they are
 *   filled with 0 openings and no pay, to keep the time axis even.
 * - Periods before we started collecting are dropped. They only hold postings that were
 *   still listed on the first day, so they undercount and would look like real history.
 */
export function trendView(
  trends: Trends | null,
  firstScrape: string | null | undefined,
  lastScrape: string | null | undefined,
): TrendView {
  const mode = trends?.granularity === "month" ? "month" : "week";
  const raw: TrendPoint[] = trends && Array.isArray(trends.points) ? trends.points : [];
  const first = parseDate(firstScrape)?.getTime() ?? null;
  const last = parseDate(lastScrape)?.getTime() ?? null;

  let timed = raw.map((p) => ({ p, start: startOf(p.period, mode) }));
  const readable = timed.length > 0 && timed.every((x) => x.start != null);
  if (readable) {
    const from = first == null ? null : periodStart(first, mode);
    const byStart = new Map(
      timed
        .map((x) => ({ p: x.p, start: periodStart(x.start as number, mode) }))
        .filter((x) => from == null || x.start >= from)
        .map((x) => [x.start, x.p] as const),
    );
    timed = [];
    if (byStart.size) {
      const keys = [...byStart.keys()];
      const end = Math.max(...keys);
      for (let t = Math.min(...keys), guard = 0; t <= end && guard < 600; t = nextStart(t, mode), guard++) {
        timed.push({
          p: byStart.get(t) ?? { period: new Date(t).toISOString().slice(0, 10), postings: 0, openings: 0, median_pay: null },
          start: t,
        });
      }
    }
  }

  const list: Bucket[] = timed.map(({ p, start }, i) => {
    const d = start == null ? null : new Date(start);
    let label = String(p.period);
    let long = String(p.period);
    let end: number | null = null;
    if (d) {
      const yy = String(d.getUTCFullYear()).slice(2);
      if (mode === "week") {
        label = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
        long = `Week of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        end = d.getTime() + 7 * DAY;
      } else {
        label = MONTHS[d.getUTCMonth()] + (d.getUTCMonth() === 0 || i === 0 ? ` ’${yy}` : "");
        long = `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      }
    }
    return {
      label,
      long,
      openings: Number(p.openings) || 0,
      postings: Number(p.postings) || 0,
      medianPay: typeof p.median_pay === "number" ? p.median_pay : null,
      month: d ? d.getUTCMonth() : null,
      start,
      // still running if the last scrape fell inside it, before its final day
      partial:
        i === timed.length - 1 && start != null && end != null && last != null && last >= start && last < end - DAY,
    };
  });
  // The busiest period and the average only look at finished periods, when there are any.
  const done = list.some((b) => !b.partial) ? list.filter((b) => !b.partial) : list;
  const vals = done.map((b) => b.openings);
  const max = vals.length ? Math.max(...vals) : 0;
  return {
    mode,
    list,
    peak: max > 0 ? list.indexOf(done[vals.indexOf(max)]) : -1,
    avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0,
  };
}

/** How long we have been collecting, in plain words. */
export function historySpan(
  firstScrape: string | null | undefined,
  lastScrape: string | null | undefined,
): string | null {
  const a = parseDate(firstScrape)?.getTime();
  const b = parseDate(lastScrape)?.getTime();
  if (a == null || b == null || b < a) return null;
  const days = Math.floor((b - a) / DAY) + 1;
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 84) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30.4)} months`;
}
