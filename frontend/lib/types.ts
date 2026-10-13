/* Shapes returned by the Openings SG API (FastAPI back end). Pay is monthly SGD; any pay value can be null. */

export type Pay = {
  p25: number | null;
  median: number | null;
  p75: number | null;
  mean: number | null;
  n: number | null;
};

export type Meta = {
  last_scrape: string | null;
  first_scrape: string | null;
  postings: number | null;
  companies: number | null;
  median_pay: number | null;
  pay_coverage: number | null;
};

export type SectorSummary = {
  sector: string;
  slug: string;
  postings: number;
  companies: number;
  pay: Pay | null;
};

export type Share = { name: string; postings: number };
export type HistogramBin = { from: number | null; to: number | null; count: number };

export type RoleSummary = {
  role: string;
  slug: string;
  postings: number;
  companies: number;
  top_sector: string | null;
  top_sector_slug: string | null;
  pay: Pay | null;
};

export type SectorDetail = SectorSummary & {
  employment_types: Share[];
  seniority: Share[];
  histogram: HistogramBin[];
  roles: RoleSummary[];
};

export type CompanyHiring = {
  company: string;
  postings: number;
  pay_min: number | null;
  pay_max: number | null;
  latest_posted: string | null;
  url: string | null;
};

export type RoleDetail = RoleSummary & {
  sectors: { sector: string; slug: string; postings: number }[];
  employment_types: Share[];
  seniority: Share[];
  companies_hiring: CompanyHiring[];
};

export type TrendPoint = {
  period: string;
  postings: number;
  median_pay: number | null;
};

export type Trends = { granularity: "week" | "month"; points: TrendPoint[] };

export type SectorsResponse = { sectors: SectorSummary[] };
export type RolesResponse = { total: number; roles: RoleSummary[] };
