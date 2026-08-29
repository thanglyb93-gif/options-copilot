"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/screener", label: "Screener" },
  { href: "/", label: "Dashboard" },
  { href: "/news", label: "News" },
  { href: "/guidance", label: "Guidance" },
  { href: "/positions", label: "Positions" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Unchanged above the lg breakpoint -- fixed-width sidebar, always visible. Hidden below lg in favor of the bottom tab bar. */
function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <nav className="hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
      <span className="mb-8 px-2 text-sm font-semibold tracking-tight text-foreground">
        options-copilot
      </span>
      <ul className="flex flex-col gap-1">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive(pathname, link.href)
                  ? "bg-white/5 text-foreground"
                  : "text-muted hover:bg-white/5 hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Below lg: a fixed bottom tab bar instead of the sidebar -- doesn't
 * consume permanent screen space the way a slide-out drawer's trigger
 * button would still need to (a hamburger button is itself always-on
 * screen real estate), and fits this app's existing dense, no-icon-
 * library dashboard look better than an overlay drawer would. Each tab
 * is a full-height flex-1 button so the tap target spans the whole
 * column (~78px wide x 56px tall at 390px viewport width), well past
 * the ~44px touch-target minimum.
 */
function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex h-14 border-t border-border bg-surface lg:hidden">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`flex flex-1 items-center justify-center px-1 text-center text-[11px] font-medium transition-colors ${
            isActive(pathname, link.href) ? "text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function Nav() {
  return (
    <>
      <DesktopSidebar />
      <BottomTabBar />
    </>
  );
}
