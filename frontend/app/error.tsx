"use client";

import Link from "next/link";
import { MCF_URL } from "@/lib/site";

/* Shown when a page that has never been generated can't reach the API. Same kind message as the inline state. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="view">
      <div className="unavailable glass" role="status">
        <h1>Live data isn&rsquo;t available right now</h1>
        <p>
          We couldn&rsquo;t load the latest postings and pay figures for this page. Nothing is wrong on your side.
          Please try again in a little while. We don&rsquo;t show estimates in their place.
        </p>
        <p>
          In the meantime you can search for jobs directly on{" "}
          <a href={MCF_URL} target="_blank" rel="noopener">
            MyCareersFuture
          </a>
          .
        </p>
        <div className="row">
          <button className="btn primary" type="button" onClick={() => reset()}>
            Try again
          </button>
          <Link className="btn" href="/">
            Go to the overview
          </Link>
        </div>
      </div>
    </main>
  );
}
