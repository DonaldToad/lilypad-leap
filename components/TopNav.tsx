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
    <header className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3">
          <img
            src="/logo/logo.png"
            alt="Lilypad Leap"
            width={44}
            height={44}
            className="h-11 w-11 rounded-2xl ring-1 ring-neutral-800"
            loading="eager"
            draggable={false}
          />

          <div className="leading-tight">
            <div className="text-lg font-bold text-neutral-50">Lilypad Leap</div>
            <div className="text-xs text-neutral-400">Product v1 (frozen) · Demo Mode</div>
          </div>
        </Link>

        {/* Demo pill */}
        <div className="hidden sm:flex">
          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/20">
            DEMO
          </span>
        </div>
      </div>

      {/* Nav pills */}
      <div className="mx-auto w-full max-w-6xl px-4 pb-4">
        <nav className="flex flex-wrap gap-2">
          {NAV.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  active
                    ? "border-neutral-600 bg-neutral-800 text-neutral-50"
                    : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                ].join(" ")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
