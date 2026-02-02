import Link from "next/link";

const NAV = [
  { label: "Profile", href: "/profile" },
  { label: "Play", href: "/play" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Verify Fairness", href: "/verify" },
  { label: "Swap", href: "/swap" },
] as const;

export default function TopNav() {
  return (
    <header className="border-b border-neutral-800">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-neutral-800 ring-1 ring-neutral-700" />
          <div className="leading-tight">
            <Link href="/" className="block text-lg font-semibold">
              Lilypad Leap
            </Link>
            <div className="text-xs text-neutral-400">
              Product v1 (frozen) • Demo Mode
            </div>
          </div>
        </div>

        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">
          DEMO
        </span>
      </div>

      <nav className="border-t border-neutral-800">
        <div className="mx-auto w-full max-w-5xl px-4 py-3">
          <ul className="flex flex-wrap gap-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
}
