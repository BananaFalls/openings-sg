import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataFoot } from "@/components/Notes";
import { SeasonView } from "@/components/SeasonView";
import { DAILY, getMeta, getSectors, getTrends, isEmpty, live, looksLikeSlug, optional } from "@/lib/api";

export const revalidate = 86400;

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const sectors = optional(await getSectors(DAILY));
  return (sectors ?? []).map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sector = looksLikeSlug(slug) ? optional(await getSectors(DAILY))?.find((s) => s.slug === slug) : null;
  if (!sector) return { title: "Hiring season by sector", alternates: { canonical: `/season/${slug}` } };
  return {
    title: `${sector.sector} hiring season in Singapore: when employers post jobs`,
    description: `How many ${sector.sector} jobs Singapore employers post each week or month on MyCareersFuture, and how far back our data goes.`,
    alternates: { canonical: `/season/${slug}` },
  };
}

export default async function SeasonSectorPage({ params }: Props) {
  const { slug } = await params;
  if (!looksLikeSlug(slug)) notFound();
  const [metaR, sectorsR, trendsR] = await Promise.all([getMeta(DAILY), getSectors(DAILY), getTrends(slug, DAILY)]);
  const meta = live(metaR);
  const sectors = live(sectorsR);
  const trends = live(trendsR); // an unknown sector is a 404 from the API, which becomes the 404 page
  const current = sectors?.find((s) => s.slug === slug) ?? null;
  if (sectors && !current) notFound();
  return (
    <main id="main" className="view">
      <SeasonView meta={meta} sectors={sectors} trends={trends} current={current} />
      <DataFoot meta={isEmpty(meta) ? null : meta} />
    </main>
  );
}
