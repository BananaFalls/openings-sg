import { NextResponse } from "next/server";
import { HOURLY, searchRoles } from "@/lib/api";

export type RoleHit = {
  role: string;
  slug: string;
  postings: number;
  median: number | null;
  sector: string | null;
};

const LIMIT = 8;

/** Role search for the home page box. The browser calls this; the API address stays on the server. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("q") ?? "";
  const q = raw.replace(/\s+/g, " ").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json({ roles: [] });

  const r = await searchRoles(q, LIMIT, HOURLY);
  if (!r.ok) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const list = Array.isArray(r.data.roles) ? r.data.roles : [];
  const roles: RoleHit[] = list.map((x) => ({
    role: x.role,
    slug: x.slug,
    postings: x.postings,
    median: x.pay?.median ?? null,
    sector: x.top_sector,
  }));
  return NextResponse.json(
    { total: Number(r.data.total) || roles.length, roles },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
