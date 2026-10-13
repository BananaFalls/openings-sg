import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar() {
  return (
    <header className="topbar glass">
      <Link className="brand" href="/">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <rect x="2" y="13" width="5" height="11" rx="2" fill="var(--accent)" />
          <rect x="10.5" y="7" width="5" height="17" rx="2" fill="var(--accent)" opacity=".7" />
          <rect x="19" y="2" width="5" height="22" rx="2" fill="var(--coral)" />
        </svg>
        {SITE_NAME}
      </Link>
      <NavLinks />
      <ThemeToggle />
    </header>
  );
}
