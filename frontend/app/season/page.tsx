import type { Metadata } from "next";
import { LabourPanel } from "@/components/LabourPanel";
import { DataFoot } from "@/components/Notes";
import { SeasonView } from "@/components/SeasonView";
import { getMeta, getSectors, getTrends, HOURLY, isEmpty, live } from "@/lib/api";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Hiring season in Singapore: when employers post the most openings",
  description:
    "See how many job openings Singapore employers post each week or month on MyCareersFuture, for all sectors or one, alongside official MOM unemployment and underemployment rates.",
  alternates: { canonical: "/season" },
};

export default async function SeasonPage() {
  const [metaR, sectorsR, trendsR] = await Promise.all([getMeta(HOURLY), getSectors(HOURLY), getTrends(null, HOURLY)]);
  const meta = live(metaR);
  const sectors = live(sectorsR);
  const trends = live(trendsR);
  return (
    <main id="main" className="view">
      <SeasonView meta={meta} sectors={sectors} trends={trends} current={null} />
      <LabourPanel />
      <DataFoot meta={isEmpty(meta) ? null : meta} />
    </main>
  );
}
