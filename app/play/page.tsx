"use client";

import TopNav from "../components/TopNav";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import { useMemo, useRef, useState } from "react";

type RouteKey = "safe" | "wild" | "insane";

const ROUTES: Record<
  RouteKey,
  {
    label: string;
    description: string;
    rows: { hop: number; success: string; cashout: string }[];
  }
> = {
  safe: {
    label: "Safe Swamp",
    description: "Lower risk curve. Smooth multipliers.",
    rows: [
      { hop: 1, success: "90.80%", cashout: "1.18x" },
      { hop: 2, success: "89.60%", cashout: "1.36x" },
      { hop: 3, success: "88.40%", cashout: "1.54x" },
      { hop: 4, success: "87.20%", cashout: "1.72x" },
      { hop: 5, success: "86.00%", cashout: "1.90x" },
      { hop: 6, success: "84.80%", cashout: "2.08x" },
      { hop: 7, success: "83.60%", cashout: "2.26x" },
      { hop: 8, success: "82.40%", cashout: "2.44x" },
      { hop: 9, success: "81.20%", cashout: "2.62x" },
      { hop: 10, success: "80.00%", cashout: "2.80x" },
    ],
  },
  wild: {
    label: "Wild Swamp",
    description: "Balanced. Noticeable risk ramp.",
    rows: [
      { hop: 1, success: "86.00%", cashout: "1.28x" },
      { hop: 2, success: "84.00%", cashout: "1.56x" },
      { hop: 3, success: "82.00%", cashout: "1.84x" },
      { hop: 4, success: "80.00%", cashout: "2.12x" },
      { hop: 5, success: "78.00%", cashout: "2.40x" },
      { hop: 6, success: "76.00%", cashout: "2.68x" },
      { hop: 7, success: "74.00%", cashout: "2.96x" },
      { hop: 8, success: "72.00%", cashout: "3.24x" },
      { hop: 9, success: "70.00%", cashout: "3.52x" },
      { hop: 10, success: "68.00%", cashout: "3.80x" },
    ],
  },
  insane: {
    label: "Insane Swamp",
    description: "High risk. Multipliers accelerate fast.",
    rows: [
      { hop: 1, success: "81.20%", cashout: "1.42x" },
      { hop: 2, success: "78.40%", cashout: "1.84x" },
      { hop: 3, success: "75.60%", cashout: "2.26x" },
      { hop: 4, success: "72.80%", cashout: "2.68x" },
      { hop: 5, success: "70.00%", cashout: "3.10x" },
      { hop: 6, success: "67.20%", cashout: "3.52x" },
      { hop: 7, success: "64.40%", cashout: "3.94x" },
      { hop: 8, success: "61.60%", cashout: "4.36x" },
      { hop: 9, success: "58.80%", cashout: "4.78x" },
      { hop: 10, success: "56.00%", cashout: "5.20x" },
    ],
  },
};

const MAX_BET_DTC = 100_000;
const MIN_BET_DTC = 1;

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function formatInt(n: number) {
  return n.toLocaleString("en-US");
}

function parsePercent(p: string) {
  const v = Number.parseFloat(p.replace("%", ""));
  return Number.isFinite(v) ? v / 100 : 0;
}

function parseX(x: string) {
  const v = Number.parseFloat(x.replace("x", ""));
  return Number.isFinite(v) ? v : 0;
}

function ChainIcon({ chainKey }: { chainKey: string }) {
  return (
    <img
      src={`/chains/${chainKey}.png`}
      alt={`${chainKey} icon`}
      width={28}
      height={28}
      className="h-7 w-7 rounded-lg ring-1 ring-neutral-800"
      loading="lazy"
    />
  );
}

export default function PlayPage() {
  const [route, setRoute] = useState<RouteKey>("safe");
  const [betStr, setBetStr] = useState<string>("1000");

  const [hops, setHops] = useState<number>(0);
  const [isBusted, setIsBusted] = useState<boolean>(false);
  const [isCashedOut, setIsCashedOut] = useState<boolean>(false);
  const [finalPayout, setFinalPayout] = useState<number | null>(null);

  // Anim state
  const [pulseHop, setPulseHop] = useState<number>(0); // increments to retrigger CSS
  const [bustFlash, setBustFlash] = useState<boolean>(false);
  const [shakeKey, setShakeKey] = useState<number>(0);

  const flashTimer = useRef<number | null>(null);

  const data = ROUTES[route];

  const bet = useMemo(() => {
    const raw = Number.parseInt(betStr.replace(/[^\d]/g, ""), 10);
    return clampInt(raw || 0, MIN_BET_DTC, MAX_BET_DTC);
  }, [betStr]);

  function onBetChange(v: string) {
    if (v.trim() === "") {
      setBetStr("");
      return;
    }
    const digits = v.replace(/[^\d]/g, "");
    setBetStr(digits);
  }

  function onBetBlur() {
    setBetStr(String(bet));
  }

  function setQuickBet(n: number) {
    const clamped = clampInt(n, MIN_BET_DTC, MAX_BET_DTC);
    setBetStr(String(clamped));
  }

  const currentCashoutX = useMemo(() => {
    if (hops <= 0) return 1.0;
    const row = data.rows[Math.min(hops, 10) - 1];
    return parseX(row.cashout);
  }, [hops, data.rows]);

  const potentialPayout = useMemo(() => {
    if (hops <= 0) return null;
    return Math.floor(bet * currentCashoutX);
  }, [bet, currentCashoutX, hops]);

  const nextHopIndex = Math.min(hops, 10);
  const nextHopRow = data.rows[nextHopIndex] ?? null;
  const nextHopSuccess = nextHopRow ? nextHopRow.success : "—";

  function resetRun() {
    setHops(0);
    setIsBusted(false);
    setIsCashedOut(false);
    setFinalPayout(null);
    setBustFlash(false);
    setShakeKey((k) => k + 1);
    setPulseHop((p) => p + 1);
  }

  function onChangeRoute(r: RouteKey) {
    setRoute(r);
    resetRun();
  }

  function triggerBustFlash() {
    setBustFlash(true);
    setShakeKey((k) => k + 1);

    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      setBustFlash(false);
      flashTimer.current = null;
    }, 380);
  }

  function onHop() {
    if (isBusted || isCashedOut) return;
    if (hops >= 10) return;

    const row = data.rows[hops];
    const successProb = parsePercent(row.success);
    const roll = Math.random();

    if (roll <= successProb) {
      setHops((h) => h + 1);
      setPulseHop((p) => p + 1); // re-trigger row pop
    } else {
      setIsBusted(true);
      setFinalPayout(0);
      triggerBustFlash();
    }
  }

  function onCashOut() {
    if (isBusted || isCashedOut) return;
    if (hops <= 0) return;

    const payout = Math.floor(bet * currentCashoutX);
    setIsCashedOut(true);
    setFinalPayout(payout);
    setPulseHop((p) => p + 1);
  }

  const hopDisabled = isBusted || isCashedOut || hops >= 10;
  const cashOutDisabled = isBusted || isCashedOut || hops <= 0;

  // Active row = the next hop row while running; if busted/cashed/finished, none.
  const activeHop = !isBusted && !isCashedOut && hops < 10 ? hops + 1 : null;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      {/* Inline keyframes (no deps) */}
      <style>{`
        @keyframes hopPop {
          0% { transform: translateY(0) scale(1); box-shadow: 0 0 0 rgba(16,185,129,0); }
          40% { transform: translateY(-2px) scale(1.01); box-shadow: 0 0 24px rgba(16,185,129,0.22); }
          100% { transform: translateY(0) scale(1); box-shadow: 0 0 0 rgba(16,185,129,0); }
        }
        @keyframes bustFlash {
          0% { opacity: 0; }
          15% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes rowShake {
          0% { transform: translateX(0); }
          20% { transform: translateX(-4px); }
          40% { transform: translateX(4px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
          100% { transform: translateX(0); }
        }
      `}</style>

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Play</h1>
              <p className="mt-2 text-neutral-300">
                Demo Mode. No wallet required. Choose your route, set a bet,
                then decide: <b>HOP</b> or <b>CASH OUT</b> — up to 10 hops.
              </p>
            </div>
            <div className="text-sm text-neutral-400">
              Primary:{" "}
              <span className="text-neutral-100">{PRIMARY_CHAIN.name}</span>
            </div>
          </div>

          {/* Chain selection */}
          <div className="mt-6 grid gap-3">
            {CHAIN_LIST.map((c) => (
              <div
                key={c.key}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <ChainIcon chainKey={c.key} />
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-semibold">{c.name}</div>
                        <span
                          className={
                            c.statusTag === "LIVE"
                              ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-500/20"
                              : "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-amber-500/20"
                          }
                        >
                          {c.statusTag}
                        </span>
                        {c.isPrimary && (
                          <span className="rounded-full bg-neutral-800/60 px-2 py-0.5 text-xs ring-1 ring-neutral-700">
                            PRIMARY
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-neutral-300">{c.note}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      Chain ID: {c.chainId} • Explorer:{" "}
                      {c.explorerBaseUrl?.replace("https://", "")}
                    </p>
                  </div>
                  <button
                    disabled
                    className="cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-500"
                  >
                    {c.enabled ? "Play (demo)" : "Play (soon)"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Demo UI */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
            {/* Controls */}
            <div
              key={shakeKey}
              className={
                "relative rounded-2xl border border-neutral-800 bg-neutral-950 p-4 " +
                (isBusted ? "" : "")
              }
              style={isBusted ? { animation: "rowShake 420ms ease" } : undefined}
            >
              {/* Busted flash overlay */}
              {bustFlash ? (
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-red-500/30"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 40%, rgba(239,68,68,0.22), rgba(239,68,68,0.04) 55%, rgba(0,0,0,0) 72%)",
                    animation: "bustFlash 380ms ease-out",
                  }}
                />
              ) : null}

              <h3 className="font-semibold">Demo Controls</h3>

              <div className="mt-4">
                <div className="text-sm text-neutral-400">Route</div>
                <div className="mt-2 flex gap-2">
                  {(["safe", "wild", "insane"] as RouteKey[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => onChangeRoute(r)}
                      className={
                        route === r
                          ? "rounded-xl bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/30"
                          : "rounded-xl bg-neutral-900 px-4 py-2 text-sm ring-1 ring-neutral-800"
                      }
                    >
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-neutral-500">{data.description}</p>
              </div>

              <div className="mt-4">
                <div className="text-sm text-neutral-400">Bet (DTC)</div>

                <input
                  value={betStr}
                  onChange={(e) => onBetChange(e.target.value)}
                  onBlur={onBetBlur}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Enter amount"
                  className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-500/40"
                />

                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setQuickBet(1_000)}
                    className="rounded-xl bg-neutral-900 px-3 py-1 text-xs ring-1 ring-neutral-800 hover:bg-neutral-800"
                  >
                    1k
                  </button>
                  <button
                    onClick={() => setQuickBet(10_000)}
                    className="rounded-xl bg-neutral-900 px-3 py-1 text-xs ring-1 ring-neutral-800 hover:bg-neutral-800"
                  >
                    10k
                  </button>
                  <button
                    onClick={() => setQuickBet(100_000)}
                    className="rounded-xl bg-neutral-900 px-3 py-1 text-xs ring-1 ring-neutral-800 hover:bg-neutral-800"
                  >
                    100k
                  </button>
                </div>

                <p className="mt-2 text-xs text-neutral-500">
                  Max bet:{" "}
                  <span className="text-neutral-300">{formatInt(MAX_BET_DTC)} DTC</span>
                </p>

                <p className="mt-1 text-xs text-neutral-500">Demo only. No transactions.</p>
              </div>

              <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Run status</span>
                  <span
                    className={
                      isBusted
                        ? "rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-300 ring-1 ring-red-500/20"
                        : "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-500/20"
                    }
                  >
                    {isBusted ? "BUSTED" : "DEMO"}
                  </span>
                </div>

                <div className="mt-2 flex justify-between">
                  <span>Hops</span>
                  <span>
                    {hops} / 10
                  </span>
                </div>

                <div className="mt-1 flex justify-between">
                  <span>Current cashout</span>
                  <span>{hops <= 0 ? "—" : `${currentCashoutX.toFixed(2)}x`}</span>
                </div>

                <div className="mt-1 flex justify-between">
                  <span>Potential payout</span>
                  <span>{potentialPayout == null ? "—" : `${formatInt(potentialPayout)} DTC`}</span>
                </div>

                <div className="mt-1 flex justify-between">
                  <span>Next hop success</span>
                  <span>{isBusted || hops >= 10 ? "—" : nextHopSuccess}</span>
                </div>

                {finalPayout !== null ? (
                  <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-300">
                    <b>Result:</b>{" "}
                    {isBusted
                      ? "BUSTED — payout 0 DTC"
                      : `CASHED OUT — payout ${formatInt(finalPayout)} DTC`}
                  </div>
                ) : null}

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={onHop}
                    disabled={hopDisabled}
                    className={
                      hopDisabled
                        ? "flex-1 cursor-not-allowed rounded-xl bg-neutral-800 px-4 py-2 text-sm font-bold text-neutral-500"
                        : "flex-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:brightness-110"
                    }
                  >
                    HOP
                  </button>

                  <button
                    onClick={onCashOut}
                    disabled={cashOutDisabled}
                    className={
                      cashOutDisabled
                        ? "flex-1 cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-500"
                        : "flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/15"
                    }
                  >
                    CASH OUT
                  </button>
                </div>

                <button
                  onClick={resetRun}
                  className="mt-2 w-full rounded-xl border border-neutral-800 py-2 text-xs hover:bg-neutral-950"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Per-hop risk & cashout (demo table)</h3>
                <span className="text-sm text-neutral-400">Route: {data.label}</span>
              </div>

              <p className="mt-1 text-xs text-neutral-500">
                UI placeholders with local RNG. On-chain wiring comes later (commit-reveal verifier).
              </p>

              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-neutral-400">
                    <th className="py-2 text-left">Hop</th>
                    <th className="py-2 text-left">Success</th>
                    <th className="py-2 text-right">Cashout</th>
                  </tr>
                </thead>

                <tbody>
                  {data.rows.map((r) => {
                    const isActive = activeHop === r.hop;
                    const isReached = r.hop <= hops;
                    const shouldPop = isActive && pulseHop > 0;

                    // Clean highlight: reached rows = subtle emerald tint; active row = glow + pop.
                    const rowClass =
                      "border-t border-neutral-800 transition-colors " +
                      (isReached ? "bg-emerald-500/5" : "") +
                      (isActive ? " bg-emerald-500/10" : "");

                    const rowStyle: React.CSSProperties | undefined = shouldPop
                      ? {
                          animation: "hopPop 320ms ease-out",
                          outline: "1px solid rgba(16,185,129,0.18)",
                          borderRadius: 12,
                        }
                      : isActive
                      ? {
                          outline: "1px solid rgba(16,185,129,0.14)",
                          borderRadius: 12,
                        }
                      : undefined;

                    return (
                      <tr key={r.hop} className={rowClass} style={rowStyle}>
                        <td className="py-2">{r.hop}</td>
                        <td className="py-2">{r.success}</td>
                        <td className="py-2 text-right font-semibold">{r.cashout}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
                Demo behavior: HOP uses local RNG against the displayed Success %. CASH OUT locks the current
                multiplier. No transactions yet.
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
