import Link from "next/link";
import { fmtDate, isoDay } from "@/lib/format";
import { MCF_URL } from "@/lib/site";
import type { Meta } from "@/lib/types";

const Mcf = () => (
  <a href={MCF_URL} target="_blank" rel="noopener">
    MyCareersFuture
  </a>
);

/** "Last updated 13 Oct 2026 · Source: MyCareersFuture". Shown wherever live figures appear. */
export function Stamp({ meta }: { meta: Meta | null }) {
  const when = fmtDate(meta?.last_scrape);
  return (
    <p className="stamp">
      {when ? (
        <>
          Last updated <time dateTime={isoDay(meta?.last_scrape)}>{when}</time> ·{" "}
        </>
      ) : null}
      Source: <Mcf />
    </p>
  );
}

/** How many postings still need a vacancy count, as a share from 0 to 1 (null = nothing left to collect). */
function vacancyGap(meta: Meta | null): number | null {
  if (!meta || !meta.postings) return null;
  const cov = meta.vacancy_coverage;
  if (typeof cov !== "number" || !Number.isFinite(cov)) return 1;
  return cov >= 1 ? null : Math.min(1, Math.max(0, 1 - cov));
}

/**
 * Shown near openings figures while vacancy counts are still being collected.
 * Written for job seekers: what it means for the number they are looking at.
 */
export function VacancyNote({ meta }: { meta: Meta | null }) {
  const gap = vacancyGap(meta);
  if (gap == null) return null;
  const share = Math.round(gap * 100);
  const known = typeof meta?.vacancy_coverage === "number";
  const who = !known ? "Some postings are" : share >= 1 ? `About ${share}% of postings are` : "A few postings are";
  return (
    <p className="note-box">
      <strong>Openings are still being counted.</strong> {who} counted as one opening for now, until we know how many
      people each one is hiring for. The real number of openings is probably higher.
    </p>
  );
}

/** The kind, plain state for when the API is down, not set up, or has nothing yet. Never shows made-up numbers. */
export function Unavailable({
  empty = false,
  heading = "h2",
  children,
}: {
  /** The API answered, but nothing has been collected yet. */
  empty?: boolean;
  heading?: "h1" | "h2";
  children?: React.ReactNode;
}) {
  const H = heading;
  return (
    <div className="unavailable glass" role="status">
      <H>{empty ? "No openings collected yet" : "Live data isn’t available right now"}</H>
      {empty ? (
        <p>
          The first collection of postings from MyCareersFuture hasn&rsquo;t finished yet. Please check back soon. We
          won&rsquo;t show numbers until they are real.
        </p>
      ) : (
        <p>
          We couldn&rsquo;t load the latest openings and pay figures. Nothing is wrong on your side. Please try again
          in a little while. We don&rsquo;t show estimates in their place.
        </p>
      )}
      <p>
        In the meantime you can search for jobs directly on <Mcf />.
      </p>
      {children}
    </div>
  );
}

/** Footer for pages that show live figures: how the numbers are worked out, and where they come from. */
export function DataFoot({ meta }: { meta: Meta | null }) {
  const when = fmtDate(meta?.last_scrape);
  const since = fmtDate(meta?.first_scrape);
  const payShare =
    meta && meta.postings && typeof meta.pay_coverage === "number" ? Math.round(meta.pay_coverage * 100) : null;
  return (
    <footer className="foot glass">
      <p>
        Pay is monthly SGD, taken as the midpoint of each posting&rsquo;s advertised range. It is what employers
        advertise, not what people are finally paid, so use it as a starting point.
        {payShare != null ? ` About ${payShare}% of postings state their pay; the rest are left out of pay figures.` : ""}
      </p>
      <p>
        &ldquo;Openings&rdquo; counts vacancies, so one posting can hold several. &ldquo;Postings&rdquo; counts
        listings.
        {vacancyGap(meta) != null
          ? " Vacancy counts are still being collected, so some postings count as one opening for now."
          : ""}
      </p>
      <p>
        Source: postings on <Mcf />
        {since ? `, collected daily since ${since}` : ""}.{" "}
        {when ? (
          <>
            Last updated <time dateTime={isoDay(meta?.last_scrape)}>{when}</time>.{" "}
          </>
        ) : null}
        <Link href="/about">About this site</Link>
      </p>
    </footer>
  );
}
