import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar() {
  return (
    <header className="topbar glass">
      <Link className="brand" href="/" aria-label={SITE_NAME}>
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <rect x="1" y="1" width="24" height="24" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="6" y="13" width="3.5" height="6" fill="var(--accent)" />
          <rect x="11.25" y="10" width="3.5" height="9" fill="var(--accent)" />
          <rect x="16.5" y="6.5" width="3.5" height="12.5" fill="var(--accent)" />
          <rect x="5" y="19.75" width="16" height="1.25" fill="currentColor" />
        </svg>
        <span className="brand-name">Openings</span>
        <span className="brand-sg">SG</span>
      </Link>
      <NavLinks />
      <ThemeToggle />
    </header>
  );
}
