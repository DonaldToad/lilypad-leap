"use client";

import { useMemo, useState } from "react";
import TopNav from "../components/TopNav";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import { ROUTE_TABLES, RouteKey } from "../lib/demoTables";

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

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function PlayPage() {
  const [route, setRoute] = useState<RouteKey>("SAFE");
  const [bet, setBet] = useState<string>("1000");
  const [hopIndex, setHopIndex] = useState<number>(0); // 0..10 (0 = not started)
  const [isBusted, setIsBusted] = useState<boolean>(false);

  const table = ROUTE_TABLES[route];

  const currentRow = useMemo(() => {
    if (hopIndex <= 0) return null;
    return table.rows[Math.min(hopIndex, 10) - 1] ?? null;
  }, [hopIndex, table.rows]);

  const previewRow = useMemo(() => {
    const nextHop = Math.min(hopIndex + 1, 10);
    return table.rows[nextHop - 1] ?? null;
  }, [hopIndex, table.rows]);

  const betNum = useMemo(() => {
    const n = Number(bet);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [bet]);

  const potentialPayout = useMemo(() => {
    if (!currentRow || betNum <= 0) return 0;
    return betNum * currentRow.cashoutX;
  }, [betNum, currentRow]);

  function resetRun() {
    setHopIndex(0);
    setIsBusted(false);
  }

  // Demo-only: no RNG. We simulate a “bust” visually if user clicks Hop after hop 10.
  function onHop() {
    if (isBusted) return;
    if (hopIndex >= 10) return;

    const next = hopIndex + 1;
    setHopIndex(next);

    // purely UI: if next hop is 10, keep it successful; we never bust automatically
    // later Step 8 adds local RNG + reveal visualization.
  }

  function onCashOut() {
    if (isBusted) return;
    if (hopIndex <= 0) return;
    // UI only: we “lock” by resetting but keeping a small toast-like message later
    resetRun();
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        {/* Header */}
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Play</h1>
              <p className="mt-2 text-neutral-300">
                Demo Mode. No wallet required. Choose your route, set a bet, then
                decide: <b>HOP</b> or <b>CASH OUT</b> — up to <b>10 hops</b>.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Primary:{" "}
              <span className="text-neutral-100">{PRIMARY_CHAIN.name}</span>
            </div>
          </div>

          {/* Chain cards (read-only context) */}
          <div className="mt-6 grid gap-3">
            {CHAIN_LIST.map((c) => (
              <div
                key={c.key}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4"
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

                        {c.isPrimary && (
                          <span className="rounded-full bg-neutral-800/60 px-2 py-0.5 text-xs text-neutral-200 ring-1 ring-neutral-700">
                            PRIMARY
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 text-sm text-neutral-300">{c.note}</div>

                    <div className="mt-3 text-xs text-neutral-500">
                      Chain ID: {c.chainId}
                      {c.explorerBaseUrl && (
                        <>
                          {" "}
                          • Explorer:{" "}
                          <span className="text-neutral-300">
                            {c.explorerBaseUrl.replace("https://", "")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      disabled
                      className="cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-500"
                    >
                      {c.enabled ? "Play (demo)" : "Play (soon)"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Game panel */}
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {/* Left: controls */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 lg:col-span-1">
              <div className="text-sm font-semibold text-neutral-200">
                Demo Controls
              </div>

              {/* Route select */}
              <div className="mt-4">
                <div className="text-xs text-neutral-400">Route</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["SAFE", "WILD", "INSANE"] as RouteKey[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        setRoute(k);
                        resetRun();
                      }}
                      className={classNames(
                        "rounded-xl border px-3 py-2 text-sm font-semibold",
                        route === k
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                          : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                      )}
                    >
                      {ROUTE_TABLES[k].label.split(" ")[0]}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-xs text-neutral-500">
                  {table.tagline}
                </div>
              </div>

              {/* Bet input */}
              <div className="mt-5">
                <div className="text-xs text-neutral-400">Bet (DTC)</div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={bet}
                    onChange={(e) => setBet(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500/40"
                  />
                  <button
                    onClick={() => setBet("1000")}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-800"
                  >
                    1k
                  </button>
                  <button
                    onClick={() => setBet("10000")}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-800"
                  >
                    10k
                  </button>
                </div>
                <div className="mt-2 text-xs text-neutral-500">
                  Demo only. No transactions.
                </div>
              </div>

              {/* Status */}
              <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-neutral-400">Run status</div>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                    DEMO
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-sm text-neutral-200">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Hops</span>
                    <span className="font-semibold">{hopIndex}/10</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Current cashout</span>
                    <span className="font-semibold">
                      {currentRow ? `${currentRow.cashoutX.toFixed(2)}x` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Potential payout</span>
                    <span className="font-semibold">
                      {potentialPayout > 0 ? potentialPayout.toFixed(2) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Next hop success</span>
                    <span className="font-semibold">
                      {previewRow ? `${previewRow.successPct.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={onHop}
                    disabled={betNum <= 0 || hopIndex >= 10 || isBusted}
                    className={classNames(
                      "w-full rounded-xl px-4 py-2 text-sm font-semibold",
                      betNum <= 0 || hopIndex >= 10 || isBusted
                        ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                        : "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                    )}
                  >
                    HOP
                  </button>

                  <button
                    onClick={onCashOut}
                    disabled={hopIndex <= 0 || isBusted}
                    className={classNames(
                      "w-full rounded-xl border px-4 py-2 text-sm font-semibold",
                      hopIndex <= 0 || isBusted
                        ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                        : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                    )}
                  >
                    CASH OUT
                  </button>
                </div>

                <button
                  onClick={resetRun}
                  className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-900"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Right: hop table */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 lg:col-span-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-neutral-200">
                    Per-hop risk & cashout (demo table)
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    These values are UI placeholders. We’ll swap to on-chain math
                    later.
                  </div>
                </div>

                <div className="text-xs text-neutral-400">
                  Route: <span className="text-neutral-200">{table.label}</span>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800">
                <div className="grid grid-cols-3 bg-neutral-900 px-4 py-3 text-xs font-semibold text-neutral-300">
                  <div>Hop</div>
                  <div>Success</div>
                  <div className="text-right">Cashout</div>
                </div>

                <div className="divide-y divide-neutral-800">
                  {table.rows.map((r) => {
                    const isActive = hopIndex === r.hop;
                    const isPassed = hopIndex > r.hop;

                    return (
                      <div
                        key={r.hop}
                        className={classNames(
                          "grid grid-cols-3 px-4 py-3 text-sm",
                          isActive && "bg-emerald-500/10",
                          isPassed && "opacity-60"
                        )}
                      >
                        <div className="font-semibold text-neutral-100">
                          {r.hop}
                        </div>
                        <div className="text-neutral-200">
                          {r.successPct.toFixed(2)}%
                        </div>
                        <div className="text-right font-semibold text-neutral-100">
                          {r.cashoutX.toFixed(2)}x
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
                <b>Demo behavior:</b> this UI does not bust or settle bets yet.
                Next step adds local RNG + outcome animation, then commit–reveal
                verifier and on-chain wiring.
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
