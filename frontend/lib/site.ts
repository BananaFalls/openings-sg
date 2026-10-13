export const SITE_NAME = "Openings SG";
export const TAGLINE = "For the unemployed, by an unemployed.";
export const MCF_URL = "https://www.mycareersfuture.gov.sg/";

const fromEnv =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

/** Public address of the site, used for canonical links, the sitemap and robots.txt. */
export const SITE_URL = (/^https?:\/\//.test(fromEnv) ? fromEnv : "http://localhost:3000").replace(/\/+$/, "");
