import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RangeBar, ShareBars } from "@/components/Bars";
import { Histogram } from "@/components/Charts";
import { ExperiencePay } from "@/components/ExperiencePay";
import { More } from "@/components/More";
import { DataFoot, Stamp, Unavailable } from "@/components/Notes";
import { SectorPicker } from "@/components/SectorPicker";
import { DAILY, getMeta, getSector, getSectors, getTrends, isEmpty, live, looksLikeSlug, optional } from "@/lib/api";
import { count, fmtDate, int, money, niceMax } from "@/lib/format";
import { trendView } from "@/lib/trends";

/* Search-traffic page: built ahead of time for every sector, refreshed about once a day. */
export const revalidate = 86400;

type Props = { params: Promise<{ slug: string }> };

const SHOWN_ROLES = 15;
/* The API sends a sector's roles with the most postings, up to this many (see sector_detail in backend/main.py). */
const ROLE_CAP = 200;

export async function generateStaticParams() {
  const sectors = optional(await getSectors(DAILY));
  return (sectors ?? []).map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const canonical = `/sectors/${slug}`;
  const [s, meta] = looksLikeSlug(slug)
    ? await Promise.all([getSector(slug, DAILY).then(optional), getMeta(DAILY).then(optional)])
    : [null, null];
  if (!s) return { title: "Sector pay and job postings in Singapore", alternates: { canonical } };
  const pay = s.pay;
  const updated = fmtDate(meta?.last_scrape);
  const title = `${s.sector} jobs and pay in Singapore`;
  const description =
    `${count(s.postings, "job posting", "job postings")} in ${s.sector} from ${count(s.companies, "company", "companies")} on MyCareersFuture.` +
    (pay?.median != null
      ? ` Median advertised pay ${money(pay.median)} a month` +
        (pay.p25 != null && pay.p75 != null ? ` (middle half ${money(pay.p25)} to ${money(pay.p75)}).` : ".")
      : "") +
    " See the roles hiring and what each one advertises." +
    (updated ? ` Updated ${updated}.` : "");
  return { title, description, alternates: { canonical }, openGraph: { title, description, url: canonical } };
}

export default async function SectorPage({ params }: Props) {
  const { slug } = await params;
  if (!looksLikeSlug(slug)) notFound();
  const [sR, metaR, sectorsR, trendsR] = await Promise.all([
    getSector(slug, DAILY),
    getMeta(DAILY),
    getSectors(DAILY),
    getTrends(slug, DAILY),
  ]);
  const s = live(sR);
  const meta = live(metaR);
  const sectors = optional(sectorsR) ?? [];
  const trends = optional(trendsR);

  if (!s) {
    return (
      <main id="main" className="view">
        <section className="panel glass">
          <Link className="back" href="/sectors">
            ← All sectors
          </Link>
          <Unavailable heading="h1" empty={!!meta && isEmpty(meta)} />
        </section>
      </main>
    );
  }

  const pay = s.pay;
  const roles = Array.isArray(s.roles) ? s.roles.slice().sort((a, b) => b.postings - a.postings) : [];
  const capped = roles.length >= ROLE_CAP;
  const scale = niceMax(Math.max(0, ...roles.map((r) => r.pay?.p75 ?? 0)) * 1.05);
  const byPostings = sectors.slice().sort((a, b) => b.postings - a.postings);
  const rank = byPostings.findIndex((x) => x.slug === s.slug) + 1;
  const vs =
    pay?.median != null && meta?.median_pay ? Math.round((pay.median / meta.median_pay - 1) * 100) : null;
  const view = trendView(trends, meta?.first_scrape, meta?.last_scrape);
  const busiest = view.peak >= 0 && view.list.filter((b) => !b.partial).length >= 2 ? view.list[view.peak] : null;
  const hasPay = Array.isArray(s.histogram) && s.histogram.some((b) => b.count > 0);
  const levels = (Array.isArray(s.experience) ? s.experience : []).filter((l) => l && l.postings > 0);

  const rolesTable = (
    <div className="tbl-wrap">
      <table>
        <caption className="vh">Roles in {s.sector}, with postings and advertised pay</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col" className="num">
              Postings
            </th>
            <th scope="col" className="num">
              Median
            </th>
            <th scope="col">Middle half</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r, i) => (
            <tr key={r.slug} className={i >= SHOWN_ROLES ? "extra" : undefined}>
              <td className="role">
                <Link href={`/roles/${r.slug}`}>{r.role}</Link>
              </td>
              <td className="num">{int(r.postings)}</td>
              <td className="num">{money(r.pay?.median)}</td>
              <td className="rng">
                <RangeBar p25={r.pay?.p25} median={r.pay?.median} p75={r.pay?.p75} scale={scale} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <main id="main" className="view">
      <section className="panel glass" aria-labelledby="sectorTitle">
        <Link className="back" href="/sectors">
          ← All sectors
        </Link>
        <div className="detail-head">
          <div>
            <div className="eyebrow">Sector deep-dive</div>
            <h1 className="dd-title" id="sectorTitle">
              {s.sector}: jobs and pay in Singapore
            </h1>
            <p className="hint">
              {count(s.postings, "job posting", "job postings")} from{" "}
              {count(s.companies, "company", "companies")}
              {busiest ? ` · busiest so far: ${busiest.long}` : ""}
            </p>
            <div className="dd-chips">
              {rank > 0 ? (
                <span className="chip">
                  #{rank} of {sectors.length} for postings
                </span>
              ) : null}
              {vs != null ? (
                <span className={`chip${vs < 0 ? " neg" : ""}`}>
                  Median {vs >= 0 ? "+" : ""}
                  {vs}% vs all sectors
                </span>
              ) : null}
            </div>
            <Stamp meta={meta} />
          </div>
          <div className="dd-actions">
            {sectors.length ? (
              <SectorPicker
                sectors={sectors.map((x) => ({ sector: x.sector, slug: x.slug }))}
                current={s.slug}
                base="/sectors"
                label="Switch sector"
              />
            ) : null}
            <Link className="btn" href={`/season/${s.slug}`}>
              Hiring season for this sector
            </Link>
          </div>
        </div>

        <div className="stats">
          <div className="stat key">
            <div className="label">Median pay</div>
            <div className="v">{money(pay?.median)}</div>
          </div>
          <div className="stat">
            <div className="label">Mean pay</div>
            <div className="v">{money(pay?.mean)}</div>
          </div>
          <div className="stat">
            <div className="label">25th percentile</div>
            <div className="v">{money(pay?.p25)}</div>
          </div>
          <div className="stat">
            <div className="label">75th percentile</div>
            <div className="v">{money(pay?.p75)}</div>
          </div>
          <div className="stat">
            <div className="label">Postings that state pay</div>
            <div className="v">{int(pay?.n)}</div>
          </div>
          <div className="stat">
            <div className="label">Companies hiring</div>
            <div className="v">{int(s.companies)}</div>
          </div>
        </div>

        <div className="detail-grid">
          <div className="col">
            <div>
              <h2 className="h3">Advertised pay in {s.sector}</h2>
              {hasPay ? (
                <>
                  <Histogram bins={s.histogram} median={pay?.median} />
                  <p className="hint">
                    Postings by monthly pay midpoint, in SGD. The bright bar holds the median. This is advertised pay,
                    not final pay.
                  </p>
                </>
              ) : (
                <p className="hint">None of the postings in this sector state their pay yet.</p>
              )}
            </div>
            {levels.length ? <ExperiencePay sector={s.sector} levels={levels} /> : null}
            <div className="split">
              <div>
                <h3>Employment type</h3>
                <ShareBars items={s.employment_types} empty="Not stated on these postings." />
              </div>
              <div>
                <h3>Seniority</h3>
                <ShareBars items={s.seniority} empty="Not stated on these postings." />
              </div>
            </div>
            <p className="hint">Shares are of postings in this sector.</p>
          </div>
          <div className="col">
            <div>
              <h2 className="h3">Roles hiring in {s.sector}</h2>
              {roles.length === 0 ? (
                <p className="hint">No roles to list for this sector yet.</p>
              ) : roles.length > SHOWN_ROLES ? (
                <More label={capped ? `Show the top ${roles.length} roles` : `Show all ${roles.length} roles`}>
                  {rolesTable}
                </More>
              ) : (
                rolesTable
              )}
              <p className="hint">
                {capped ? `These are the ${roles.length} roles with the most postings in this sector. ` : ""}
                Pick a role to see which companies are hiring and what each one offers.
              </p>
            </div>
          </div>
        </div>
      </section>
      <DataFoot meta={meta} />
    </main>
  );
}
