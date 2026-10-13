"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview", match: (p: string) => p === "/" },
  { href: "/season", label: "Hiring season", match: (p: string) => p.startsWith("/season") },
  { href: "/sectors", label: "Sectors", match: (p: string) => p.startsWith("/sectors") || p.startsWith("/roles") },
  { href: "/about", label: "About", match: (p: string) => p.startsWith("/about") },
];

export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <nav className="nav" aria-label="Pages">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
