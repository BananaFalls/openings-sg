import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar() {
  return (
    <header className="topbar">
      <Link className="brand" href="/" aria-label={SITE_NAME}>
        <span className="brand-name">Openings</span>
        <span className="brand-sg">SG</span>
      </Link>
      <NavLinks />
      <ThemeToggle />
    </header>
  );
}
