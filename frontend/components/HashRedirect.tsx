"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/* Old links from the single-file MVP used hashes (/#season, /#kopi). Send them to the new routes. */
const HASH_ROUTES: Record<string, string> = {
  season: "/season",
  sectors: "/sectors",
  sector: "/sectors",
  about: "/about",
  kopi: "/about#kopi",
  coffee: "/about#kopi",
  business: "/about#business",
};

export function HashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const go = () => {
      const to = HASH_ROUTES[window.location.hash.slice(1)];
      if (to) router.replace(to);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [router]);
  return null;
}
