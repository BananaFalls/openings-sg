/*
 * U-6 style underutilisation: official MOM figures, June of each year.
 * Singapore has no official U-6. This adds two published rates together and the page says so.
 * Do not fill gaps with estimates: a rate that is not published yet stays null.
 */
export type LabourYear = {
  year: number;
  /** Resident unemployment rate, %, seasonally adjusted, end-June. */
  unemployment: number;
  /** Resident time-related underemployment rate, %. null = not yet published. */
  underemployment: number | null;
};

export const LABOUR: LabourYear[] = [
  { year: 2017, unemployment: 3.1, underemployment: 3.0 },
  { year: 2018, unemployment: 2.9, underemployment: 3.3 },
  { year: 2019, unemployment: 3.2, underemployment: 3.1 },
  { year: 2020, unemployment: 4.1, underemployment: 4.1 },
  { year: 2021, unemployment: 3.6, underemployment: 3.5 },
  { year: 2022, unemployment: 2.8, underemployment: 3.0 },
  { year: 2023, unemployment: 2.8, underemployment: 2.3 },
  { year: 2024, unemployment: 2.7, underemployment: 2.3 },
  { year: 2025, unemployment: 2.7, underemployment: 1.9 },
  { year: 2026, unemployment: 2.9, underemployment: null },
];

export const LABOUR_SOURCES = {
  unemployment: {
    label: "SingStat/MOM resident unemployment rate, end-June, seasonally adjusted",
    href: "https://data.gov.sg/datasets/d_285a079d823a1cc22dffb9cac325f81a/view",
  },
  underemployment: [
    {
      label: "2018",
      href: "https://stats.mom.gov.sg/iMAS_PdfLibrary/mrsd-Labour-Force-in-Singapore-Advance-Release-2018.pdf",
    },
    {
      label: "2020",
      href: "https://www.mom.gov.sg/newsroom/press-releases/2020/1203-labour-force-in-singapore-advance-release-2020",
    },
    {
      label: "2021",
      href: "https://www.mom.gov.sg/newsroom/press-releases/2021/1201-labour-force-in-singapore-advance-release-2021",
    },
    {
      label: "2023",
      href: "https://www.mom.gov.sg/newsroom/press-releases/2023/1130-labour-force-in-singapore-advance-release-2023",
    },
    {
      label: "2025",
      href: "https://www.mom.gov.sg/newsroom/press-releases/2025/1128-labour-force-in-singapore-advance-release-2025",
    },
  ],
} as const;
