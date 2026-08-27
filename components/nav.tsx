"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/news", label: "News" },
  { href: "/guidance", label: "Guidance" },
  { href: "/positions", label: "Positions" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-surface px-4 py-6">
      <span className="mb-8 px-2 text-sm font-semibold tracking-tight text-foreground">
        options-copilot
      </span>
      <ul className="flex flex-col gap-1">
        {links.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-white/5 text-foreground"
                    : "text-muted hover:bg-white/5 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
