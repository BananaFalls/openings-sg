"use client";

import { useRouter } from "next/navigation";

/**
 * A sector <select> that goes to a page when changed. `base` is the path prefix
 * ("/season" or "/sectors"); the empty value goes to `base` itself.
 * Without JavaScript the form still works: it submits ?sector=slug, which the site redirects.
 */
export function SectorPicker({
  sectors,
  current,
  base,
  label,
  allLabel,
}: {
  sectors: { sector: string; slug: string }[];
  current: string;
  base: "/season" | "/sectors";
  label: string;
  allLabel?: string;
}) {
  const router = useRouter();
  const sorted = sectors.slice().sort((a, b) => a.sector.localeCompare(b.sector));
  return (
    <form action={base} method="get">
      <select
        name="sector"
        aria-label={label}
        value={current}
        onChange={(e) => router.push(e.target.value ? `${base}/${e.target.value}` : base)}
      >
        {allLabel ? <option value="">{allLabel}</option> : null}
        {sorted.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.sector}
          </option>
        ))}
      </select>
      <noscript>
        <button className="btn" type="submit">
          Go
        </button>
      </noscript>
    </form>
  );
}
