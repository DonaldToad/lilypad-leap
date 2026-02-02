import Link from "next/link";

const NAV = [
  { label: "Profile", href: "/profile" },
  { label: "Play", href: "/play" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Verify Fairness", href: "/verify" },
  { label: "Swap", href: "/swap" },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      {/* Top bar */}
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-neutral-800 ring-1 ring-neutral-700" />
            <div className="leading-tight">
              <div className="text-lg font-semibold">Lilypad Leap</div>
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

      {/* Hero */}
      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6 shadow-sm">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
                Press your luck. Leap for DTC.
              </h1>

              <p className="mt-3 text-neutral-300">
                Lilypad Leap is a press-your-luck hop game: choose{" "}
                <b>HOP</b> for higher multipliers or <b>CASH OUT</b> to lock
                profits — up to <b>10 hops</b>.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full bg-neutral-800/60 px-3 py-1 text-xs text-neutral-200 ring-1 ring-neutral-700">
                  3 routes: Safe / Wild / Insane
                </span>
                <span className="rounded-full bg-neutral-800/60 px-3 py-1 text-xs text-neutral-200 ring-1 ring-neutral-700">
                  Commit–reveal fairness
                </span>
                <span className="rounded-full bg-neutral-800/60 px-3 py-1 text-xs text-neutral-200 ring-1 ring-neutral-700">
                  DTC only
                </span>
              </div>
            </div>

            <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
              <div className="text-sm font-semibold">Next step</div>
              <p className="mt-2 text-sm text-neutral-300">
                We’ll add the 5 pages and wire the navigation next.
              </p>

              <div className="mt-4 grid gap-2">
                <Link
                  href="/play"
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-center text-sm font-semibold text-neutral-950 hover:bg-emerald-400"
                >
                  Go to Play
                </Link>
                <Link
                  href="/verify"
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-center text-sm font-semibold text-neutral-100 hover:bg-neutral-800"
                >
                  Verify Fairness
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
            <b>Status:</b> UI skeleton deployed. Game logic, bankroll, and
            indexer will be added next. No wallet required (Demo Mode).
          </div>
        </div>
      </section>
    </main>
  );
}
