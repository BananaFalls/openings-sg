import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { MCF_URL, SITE_NAME, SITE_URL, TAGLINE } from "@/lib/site";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const DESCRIPTION =
  "Free for job seekers in Singapore: see which sectors and roles are hiring and what they advertise in monthly pay, from MyCareersFuture postings. No ads, no sign-up.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: where Singapore is hiring, and what it pays`, template: `%s | ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  verification: { google: "-uWRpRknus7XMoLxBl0kxdw41vayW1xi2HK2FfedTMY" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_SG",
    title: `${SITE_NAME}: where Singapore is hiring, and what it pays`,
    description: DESCRIPTION,
  },
  twitter: { card: "summary" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <div className="sky" aria-hidden="true">
          <span className="orb o1" />
          <span className="orb o2" />
          <span className="orb o3" />
        </div>
        <div className="wrap">
          <TopBar />
          {children}
          <footer className="site-foot">
            <span>
              {SITE_NAME} · {TAGLINE}
            </span>
            <span>Free, no ads, no sign-up.</span>
            <Link href="/about">About</Link>
            <a href={MCF_URL} target="_blank" rel="noopener">
              Data from MyCareersFuture
            </a>
          </footer>
        </div>
      </body>
    </html>
  );
}
