import type { MetadataRoute } from "next";
import { DAILY, getMeta, getRoles, getSectors, optional, prerenderMinPostings } from "@/lib/api";
import { parseDate } from "@/lib/format";
import { SITE_URL } from "@/lib/site";

export const revalidate = 86400;

/** Static pages always; sector and role pages when the API can list them. Thin role pages are left out. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [metaR, sectorsR, rolesR] = await Promise.all([
    getMeta(DAILY),
    getSectors(DAILY),
    getRoles(prerenderMinPostings(), 5000, DAILY),
  ]);
  const meta = optional(metaR);
  const scraped = parseDate(meta?.last_scrape);
  // parseDate shifts date-times to Singapore time for display; shift back for a true timestamp
  const lastModified = scraped
    ? /^\d{4}-\d{2}-\d{2}$/.test(String(meta?.last_scrape))
      ? scraped
      : new Date(scraped.getTime() - 8 * 3600 * 1000)
    : undefined;
  const url = (path: string) => SITE_URL + path;

  const pages: MetadataRoute.Sitemap = [
    { url: url("/"), lastModified, changeFrequency: "daily", priority: 1 },
    { url: url("/sectors"), lastModified, changeFrequency: "daily", priority: 0.9 },
    { url: url("/season"), lastModified, changeFrequency: "daily", priority: 0.7 },
    { url: url("/about"), changeFrequency: "monthly", priority: 0.4 },
  ];
  for (const s of optional(sectorsR) ?? []) {
    pages.push({ url: url(`/sectors/${s.slug}`), lastModified, changeFrequency: "daily", priority: 0.8 });
    pages.push({ url: url(`/season/${s.slug}`), lastModified, changeFrequency: "daily", priority: 0.5 });
  }
  for (const r of optional(rolesR)?.roles ?? []) {
    pages.push({ url: url(`/roles/${r.slug}`), lastModified, changeFrequency: "daily", priority: 0.8 });
  }
  return pages;
}
