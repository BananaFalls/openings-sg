import type { Metadata } from "next";
import { DataFoot, Stamp, Unavailable } from "@/components/Notes";
import { SectorsExplorer, type RoleRow } from "@/components/SectorsExplorer";
import { getMeta, getRoles, getSectors, HOURLY, isEmpty, live, optional, prerenderMinPostings } from "@/lib/api";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Job postings and pay by sector in Singapore",
  description:
    "Compare Singapore sectors by job postings, companies hiring and advertised monthly pay, from MyCareersFuture. Search for a sector or a role.",
  alternates: { canonical: "/sectors" },
};

export default async function SectorsPage() {
  const min = prerenderMinPostings();
  const [metaR, sectorsR, rolesR] = await Promise.all([getMeta(HOURLY), getSectors(HOURLY), getRoles(min, 1000, HOURLY)]);
  const meta = live(metaR);
  const sectors = live(sectorsR);
  const roles = optional(rolesR)?.roles ?? [];
  const ok = !isEmpty(meta) && !!sectors && sectors.length > 0;

  const roleRows: RoleRow[] = roles
    .slice()
    .sort((a, b) => b.postings - a.postings)
    .map((r) => ({
      role: r.role,
      slug: r.slug,
      postings: r.postings,
      median: r.pay?.median ?? null,
      sector: r.top_sector,
      sectorSlug: r.top_sector_slug,
    }));

  return (
    <main id="main" className="view">
      <section className="panel glass" aria-labelledby="secTitle">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Sectors</div>
            <h1 className="dd-title" id="secTitle">
              Job postings and pay by sector
            </h1>
            <p className="hint">
              The bar shows the middle half of advertised pay (25th to 75th percentile); the tick is the median. Pick a
              sector to see its roles.
            </p>
            {ok ? <Stamp meta={meta} /> : null}
          </div>
        </div>
        {ok ? (
          <SectorsExplorer sectors={sectors} roles={roleRows} roleMin={min} />
        ) : (
          <Unavailable empty={!!meta && isEmpty(meta)} />
        )}
      </section>
      <DataFoot meta={ok ? meta : null} />
    </main>
  );
}
