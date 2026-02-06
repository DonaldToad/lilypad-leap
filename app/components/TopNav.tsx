// app/components/TopNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/profile", label: "Profile" },
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/verify", label: "Verify Fairness" },
  { href: "/swap", label: "Swap" },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <img
                src="/logo/logo.png"
                alt="Lilypad Leap logo"
                className="h-14 w-14 rounded-xl ring-1 ring-neutral-800 md:h-16 md:w-16"
                loading="eager"
              />
            </div>

            <div className="min-w-0">
              <div className="truncate text-lg font-bold leading-tight text-neutral-50 md:text-xl">
                Lilypad Leap
              </div>
              <div className="truncate text-xs text-neutral-400 md:text-sm">
                Product v1 (frozen)
              </div>
            </div>
          </div>

          <div className="shrink-0" />
        </div>

        <nav className="mt-4 flex flex-wrap gap-2">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  active
                    ? "border-neutral-700 bg-neutral-800 text-neutral-50"
                    : "border-neutral-800 bg-neutral-900/30 text-neutral-200 hover:bg-neutral-800/60",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
