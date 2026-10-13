import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RangeBar, ShareBars, SpanBar } from "@/components/Bars";
import { More } from "@/components/More";
import { DataFoot, Stamp, Unavailable, VacancyNote } from "@/components/Notes";
import { DAILY, getMeta, getRole, getRoles, isEmpty, live, looksLikeSlug, optional, prerenderMinPostings } from "@/lib/api";
import { count, fmtDate, int, money, niceMax } from "@/lib/format";

/* Search-traffic page ("data analyst salary Singapore"): roles with enough postings are built
   ahead of time, the rest on first visit. Refreshed about once a day. */
export const revalidate = 86400;

type Props = { params: Promise<{ slug: string }> };

const SHOWN_COMPANIES = 12;
const PRERENDER_CAP = 3000;

export async function generateStaticParams() {
  const roles = optional(await getRoles(prerenderMinPostings(), PRERENDER_CAP, DAILY));
  return (roles?.roles ?? []).map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const canonical = `/roles/${slug}`;
  const [r, meta] = looksLikeSlug(slug)
    ? await Promise.all([getRole(slug, DAILY).then(optional), getMeta(DAILY).then(optional)])
    : [null, null];
  if (!r) return { title: "Role pay and companies hiring in Singapore", alternates: { canonical } };
  const pay = r.pay;
  const updated = fmtDate(meta?.last_scrape);
  const title = `${r.role} salary in Singapore: advertised pay and who’s hiring`;
  const description =
    `${r.role} jobs in Singapore: ${count(r.openings, "opening", "openings")} from ${count(r.companies, "company", "companies")} on MyCareersFuture.` +
    (pay?.median != null
      ? ` Median advertised pay ${money(pay.median)} a month` +
        (pay.p25 != null && pay.p75 != null ? ` (middle half ${money(pay.p25)} to ${money(pay.p75)}).` : ".")
      : " Pay is not stated on these postings yet.") +
    (updated ? ` Updated ${updated}.` : "");
  return { title, description, alternates: { canonical }, openGraph: { title, description, url: canonical } };
}

export default async function RolePage({ params }: Props) {
  const { slug } = await params;
  if (!looksLikeSlug(slug)) notFound();
  const [rR, metaR] = await Promise.all([getRole(slug, DAILY), getMeta(DAILY)]);
  const r = live(rR);
  const meta = live(metaR);

  if (!r) {
    return (
      <main id="main" className="view">
        <section className="panel glass">
          <Link className="back" href="/sectors">
            ← All sectors and roles
          </Link>
          <Unavailable heading="h1" empty={!!meta && isEmpty(meta)} />
        </section>
      </main>
    );
  }

  const pay = r.pay;
  const vs = pay?.median != null && meta?.median_pay ? Math.round((pay.median / meta.median_pay - 1) * 100) : null;
  const companies = (Array.isArray(r.companies_hiring) ? r.companies_hiring : [])
    .slice()
    .sort((a, b) => (b.pay_max ?? b.pay_min ?? -1) - (a.pay_max ?? a.pay_min ?? -1) || b.openings - a.openings);
  const coScale = niceMax(Math.max(0, ...companies.map((c) => c.pay_max ?? c.pay_min ?? 0)) * 1.05);
  const payScale = niceMax((pay?.p75 ?? 0) * 1.25);
  const sectors = Array.isArray(r.sectors) ? r.sectors : [];

  const companyList = (
    <ul className="offer-list">
      {companies.map((c, i) => {
        const lo = c.pay_min ?? c.pay_max;
        const hi = c.pay_max ?? c.pay_min;
        const posted = fmtDate(c.latest_posted);
        const url = typeof c.url === "string" && /^https:\/\//.test(c.url) ? c.url : null;
        return (
          <li key={`${c.company}-${i}`} className={i >= SHOWN_COMPANIES ? "extra" : undefined}>
            <div className="oi-top">
              <span className="oi-co">{c.company || "Company not stated"}</span>
              {lo != null && hi != null ? (
                <span className="oi-pay">{lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`}</span>
              ) : (
                <span className="oi-pay none">Pay not stated</span>
              )}
            </div>
            {lo != null && hi != null ? <SpanBar lo={lo} hi={hi} scale={coScale} /> : null}
            <div className="oi-meta">
              {count(c.openings, "opening", "openings")}
              {c.postings > 1 ? ` in ${int(c.postings)} postings` : ""}
              {posted ? ` · posted ${posted}` : ""}
              {url ? (
                <>
                  {" · "}
                  <a href={url} target="_blank" rel="noopener nofollow">
                    View job on MyCareersFuture ↗<span className="vh"> ({c.company})</span>
                  </a>
                </>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <main id="main" className="view">
      <section className="panel glass" aria-labelledby="roleTitle">
        <Link className="back" href={r.top_sector_slug ? `/sectors/${r.top_sector_slug}` : "/sectors"}>
          ← {r.top_sector ?? "All sectors"}
        </Link>
        <div className="detail-head">
          <div>
            <div className="eyebrow">Role</div>
            <h1 className="dd-title" id="roleTitle">
              {r.role}: pay and companies hiring in Singapore
            </h1>
            <p className="hint">
              {count(r.openings, "opening", "openings")} across {count(r.postings, "posting", "postings")} from{" "}
              {count(r.companies, "company", "companies")}
            </p>
            <div className="dd-chips">
              {r.top_sector ? <span className="chip">Mostly in {r.top_sector}</span> : null}
              {vs != null ? (
                <span className={`chip${vs < 0 ? " neg" : ""}`}>
                  Median {vs >= 0 ? "+" : ""}
                  {vs}% vs all postings
                </span>
              ) : null}
            </div>
            <Stamp meta={meta} />
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
            <div className="label">Openings</div>
            <div className="v">{int(r.openings)}</div>
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <VacancyNote meta={meta} />
        </div>

        <div className="detail-grid">
          <div className="col">
            <div>
              <h2 className="h3">What {r.role} roles advertise</h2>
              {pay?.median != null ? (
                <>
                  <RangeBar p25={pay.p25} median={pay.median} p75={pay.p75} scale={payScale} />
                  <p className="hint" style={{ marginTop: 10 }}>
                    {pay.p25 != null && pay.p75 != null
                      ? `Half of these postings advertise between ${money(pay.p25)} and ${money(pay.p75)} a month. The median is ${money(pay.median)}.`
                      : `The median is ${money(pay.median)} a month.`}{" "}
                    Monthly SGD, midpoint of each advertised range
                    {pay.n != null ? `, from ${count(pay.n, "posting", "postings")} that state pay` : ""}. This is
                    advertised pay, not final pay.
                  </p>
                </>
              ) : (
                <p className="hint">None of the postings for this role state their pay yet.</p>
              )}
            </div>
            <div>
              <h3>Sectors hiring this role</h3>
              <ShareBars
                items={sectors.map((x) => ({ name: x.sector, postings: x.postings, href: `/sectors/${x.slug}` }))}
                empty="Not stated on these postings."
              />
            </div>
            <div className="split">
              <div>
                <h3>Employment type</h3>
                <ShareBars items={r.employment_types} empty="Not stated on these postings." />
              </div>
              <div>
                <h3>Seniority</h3>
                <ShareBars items={r.seniority} empty="Not stated on these postings." />
              </div>
            </div>
            <p className="hint">Shares are of postings for this role.</p>
          </div>

          <div className="col">
            <div className="offers">
              <div className="offers-head">
                <h2>
                  {companies.length
                    ? `${count(companies.length, "company", "companies")} hiring ${r.role}`
                    : `Companies hiring ${r.role}`}
                </h2>
                {companies.length ? <span>Sorted by highest pay offered</span> : null}
              </div>
              {companies.length === 0 ? (
                <p className="hint">No companies to list for this role right now.</p>
              ) : companies.length > SHOWN_COMPANIES ? (
                <More label={`Show all ${companies.length} companies`}>{companyList}</More>
              ) : (
                companyList
              )}
              <p className="small">
                Company names and links come straight from the postings. Check the posting itself before you apply;
                it may have closed since our last update.
              </p>
            </div>
          </div>
        </div>
      </section>
      <DataFoot meta={meta} />
    </main>
  );
}
