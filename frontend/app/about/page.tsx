import type { Metadata } from "next";
import Link from "next/link";
import { CopyBox, KopiTiers } from "@/components/Support";
import { TAGLINE } from "@/lib/site";
import { SUPPORT } from "@/lib/support";

export const metadata: Metadata = {
  title: "About: built by an engineer who is job hunting too",
  description:
    "Openings SG is a free site for job seekers in Singapore, built by an engineer between jobs. No ads, no sign-up. How to support the project or get in touch.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main id="main" className="view">
      <section className="about-hero">
        <p className="tagline">{TAGLINE}</p>
        <h1>I lost my job. So I started counting everyone else&rsquo;s.</h1>
        <p className="lede">
          Openings SG is what one engineer built to make sense of the job hunt. Now it&rsquo;s yours, free.
        </p>
      </section>

      <article className="story-short glass">
        <p className="q1">Who&rsquo;s actually hiring? What should I ask for? Is now even a good time to apply?</p>
        <div className="prose">
          <p>
            After the layoff, I asked myself those three questions every morning while scrolling MyCareersFuture.
            Nobody could answer them for me.
          </p>
          <p>
            The answers were public, just buried across thousands of listings. So I wrote a script to count them. Now
            I can see which roles have openings and what employers are offering for them, and as the data builds up,
            when hiring picks up and when it slows.
          </p>
          <p>It changed how I searched. I hope it changes yours. No ads, no sign-up. I&rsquo;m still looking too.</p>
          <p className="sig">An engineer between jobs, Singapore</p>
        </div>
      </article>

      <section className="about-grid">
        <div className="kopi glass" id="kopi" aria-labelledby="kopiTitle">
          <div className="kopi-head">
            <svg className="cup" viewBox="0 0 120 120" aria-hidden="true">
              <g fill="none" stroke="var(--muted)" strokeWidth="3" strokeLinecap="round">
                <path className="steam" d="M46 34c-6-8 6-12 0-20" />
                <path className="steam" d="M60 34c-6-8 6-12 0-20" />
                <path className="steam" d="M74 34c-6-8 6-12 0-20" />
              </g>
              <path d="M28 44h64l-6 46a10 10 0 0 1-10 9H44a10 10 0 0 1-10-9z" fill="var(--accent)" />
              <path d="M92 52h6a10 10 0 0 1 0 20h-8" fill="none" stroke="var(--accent)" strokeWidth="6" />
              <rect x="22" y="40" width="76" height="8" rx="4" fill="var(--coral)" />
            </svg>
            <div>
              <div className="eyebrow">Support the project</div>
              <h2 id="kopiTitle">Buy me a kopi</h2>
              <p className="small">
                If this helped your search, a kopi keeps the scraper running. Can&rsquo;t spare one? Sharing the site
                with a friend who&rsquo;s job hunting helps just as much.
              </p>
            </div>
          </div>
          <KopiTiers />
        </div>

        <div className="enq glass" id="business" aria-labelledby="enqTitle">
          <div className="eyebrow">For business enquiries</div>
          <h2 id="enqTitle">Work with me</h2>
          <p className="small">
            I turn messy job and salary data into answers people can act on. Get in touch about:
          </p>
          <ul className="enq-list">
            <li>
              <strong>Custom reports</strong>
              <span>Salary benchmarks and hiring trends for your sector or roles</span>
            </li>
            <li>
              <strong>Data and partnerships</strong>
              <span>Career services, schools and job-seeker programmes</span>
            </li>
            <li>
              <strong>Sponsorship</strong>
              <span>Help keep Openings SG free for job seekers</span>
            </li>
            <li>
              <strong>Hiring me</strong>
              <span>Engineering and analytics roles, full-time or contract</span>
            </li>
          </ul>
          <CopyBox label="Email" value={SUPPORT.businessEmail} placeholder="Email address coming soon" />
        </div>
      </section>

      <p className="small about-note">
        Salaries on Openings SG are what employers advertise, not final pay. Use them as a starting point.{" "}
        <Link href="/">Open the dashboard →</Link>
      </p>
    </main>
  );
}
