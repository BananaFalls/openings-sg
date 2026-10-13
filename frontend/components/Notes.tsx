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
      <H>{empty ? "No postings collected yet" : "Live data isn’t available right now"}</H>
      {empty ? (
        <p>
          The first collection of postings from MyCareersFuture hasn&rsquo;t finished yet. Please check back soon. We
          won&rsquo;t show numbers until they are real.
        </p>
      ) : (
        <p>
          We couldn&rsquo;t load the latest postings and pay figures. Nothing is wrong on your side. Please try again
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
        We count job postings, not vacancies. One posting can be hiring for several people, so the number of
        actual openings is at least this many.
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
