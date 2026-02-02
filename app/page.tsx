"use client";

import Link from "next/link";
import TopNav from "./components/TopNav";
import { CHAIN_LIST } from "./lib/chains";

function ChainIcon({ chainKey, alt }: { chainKey: string; alt: string }) {
  const src = `/chains/${chainKey}.png`;
  return (
    <img
      src={src}
      alt={alt}
      width={28}
      height={28}
      className="h-7 w-7 rounded-lg ring-1 ring-neutral-800"
      loading="lazy"
    />
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Lilypad Leap</h1>
              <p className="mt-2 text-neutral-300">
                Choose your chain. Demo is available now. Token mode comes soon.
              </p>
            </div>

            <div className="flex gap-2">
              <Link
                href="/play"
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-extrabold text-neutral-950 hover:bg-emerald-400"
              >
                Play
              </Link>
              <Link
                href="/leaderboard"
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-800/60"
              >
                Leaderboard
              </Link>
            </div>
          </div>

          {/* Chain selector cards */}
          <div className="mt-6 grid gap-3">
            {CHAIN_LIST.map((c) => {
              const explorerHost = c.explorerBaseUrl
                ? c.explorerBaseUrl.replace("https://", "")
                : null;

              return (
                <div
                  key={c.key}
                  className={[
                    "rounded-2xl border bg-neutral-950 p-4",
                    c.enabled
                      ? "border-emerald-500/20 ring-1 ring-emerald-500/10"
                      : "border-neutral-800",
                  ].join(" ")}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <ChainIcon chainKey={c.key} alt={`${c.name} icon`} />
                        <div className="flex items-center gap-2">
                          <div className="text-lg font-semibold">{c.name}</div>

                          <span
                            className={
                              c.statusTag === "LIVE"
                                ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20"
                                : "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/20"
                            }
                          >
                            {c.statusTag}
                          </span>

                          {c.isPrimary ? (
                            <span className="rounded-full bg-neutral-800/60 px-2 py-0.5 text-xs text-neutral-200 ring-1 ring-neutral-700">
                              PRIMARY
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 text-sm text-neutral-300">{c.note}</div>

                      {/* ✅ Safe optional explorer rendering */}
                      <div className="mt-3 text-xs text-neutral-500">
                        Chain ID: {c.chainId}
                        {explorerHost ? (
                          <>
                            {" "}
                            - Explorer:{" "}
                            <span className="text-neutral-300">{explorerHost}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <span
                        className={[
                          "rounded-xl border px-4 py-2 text-sm font-semibold",
                          c.enabled
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-neutral-800 bg-neutral-900 text-neutral-400",
                        ].join(" ")}
                      >
                        {c.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
            <b>Modes:</b> <span className="text-neutral-100">DEMO</span> is live now.
            <span className="mx-2 text-neutral-600">•</span>
            <span className="text-neutral-100">TOKEN</span> mode will be activated on launch.
          </div>
        </div>
      </section>
    </main>
  );
}
