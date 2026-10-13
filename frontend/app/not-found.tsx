import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main id="main" className="view">
      <div className="unavailable glass">
        <h1>We couldn&rsquo;t find that page</h1>
        <p>
          The sector or role may have no postings right now, or the link may be out of date. Nothing is wrong on your
          side.
        </p>
        <div className="row">
          <Link className="btn primary" href="/sectors">
            Browse sectors and roles
          </Link>
          <Link className="btn" href="/">
            Go to the overview
          </Link>
        </div>
      </div>
    </main>
  );
}
