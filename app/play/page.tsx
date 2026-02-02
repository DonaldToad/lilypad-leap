// app/play/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "../components/TopNav";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";

type RouteKey = "safe" | "wild" | "insane";
type RouteDef = {
  key: RouteKey;
  label: string;
  subtitle: string;
  success: number[]; // 10 hops, in %
  cashout: number[]; // 10 hops, multiplier
};

const MAX_HOPS = 10;
const MAX_BET = 100_000;

const ROUTES: RouteDef[] = [
  {
    key: "safe",
    label: "Safe",
    subtitle: "Lower risk curve. Smooth multipliers.",
    success: [90.8, 89.6, 88.4, 87.2, 86.0, 84.8, 83.6, 82.4, 81.2, 80.0],
    cashout: [1.18, 1.36, 1.54, 1.72, 1.9, 2.08, 2.26, 2.44, 2.62, 2.8],
  },
  {
    key: "wild",
    label: "Wild",
    subtitle: "Balanced. Noticeable risk ramp.",
    success: [86, 84, 82, 80, 78, 76, 74, 72, 70, 68],
    cashout: [1.28, 1.56, 1.84, 2.12, 2.4, 2.68, 2.96, 3.24, 3.52, 3.8],
  },
  {
    key: "insane",
    label: "Insane",
    subtitle: "High risk. Multipliers accelerate fast.",
    success: [81.2, 78.4, 75.6, 72.8, 70.0, 67.2, 64.4, 61.6, 58.8, 56.0],
    cashout: [1.42, 1.84, 2.26, 2.68, 3.1, 3.52, 3.94, 4.36, 4.78, 5.2],
  },
];

// --- Deterministic RNG (xorshift32) ---
function xorshift32(x: number) {
  let y = x >>> 0;
  y ^= y << 13;
  y >>>= 0;
  y ^= y >>> 17;
  y >>>= 0;
  y ^= y << 5;
  y >>>= 0;
  return y >>> 0;
}

function uint32ToRoll(u: number) {
  const r = (u / 0xffffffff) * 100;
  return Math.max(0, Math.min(99.999, r));
}

function formatRoll(v: number | null) {
  if (v === null) return "—";
  return v.toFixed(3);
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function fmtInt(n: number) {
  return n.toLocaleString("en-US");
}

function fmtX(n: number) {
  return `${n.toFixed(2)}x`;
}

function shortenHash(s: string, head = 10, tail = 10) {
  if (!s) return "—";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

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

type Outcome = "idle" | "success" | "bust" | "cashout";
type Mode = "DEMO" | "TOKEN";

export default function PlayPage() {
  // Chain selection (demo)
  const [selectedChainKey, setSelectedChainKey] = useState<string>(PRIMARY_CHAIN.key);

  // Mode (DEMO now, TOKEN later)
  const [mode, setMode] = useState<Mode>("DEMO");

  // Demo game state
  const [routeKey, setRouteKey] = useState<RouteKey>("safe");
  const route = useMemo(() => ROUTES.find((r) => r.key === routeKey)!, [routeKey]);

  const [bet, setBet] = useState<number>(1000);

  // Run lifecycle
  const [hasStarted, setHasStarted] = useState<boolean>(false);

  const [hops, setHops] = useState<number>(0); // completed hops
  const [currentMult, setCurrentMult] = useState<number>(1.0); // multiplier after completed hops
  const [isBusted, setIsBusted] = useState<boolean>(false);
  const [isCashedOut, setIsCashedOut] = useState<boolean>(false);

  // RNG state (demo)
  const [rngState, setRngState] = useState<number>(() => (Date.now() ^ 0x6a41f7f5) >>> 0);
  const seedHex = useMemo(() => `0x${(rngState >>> 0).toString(16).padStart(8, "0")}`, [rngState]);

  // We DO NOT show next roll preview (prevents “preview win/lose” UI leakage)
  // Still deterministic for demo, but only show last roll.
  const commitHash = useMemo(() => `commit:${seedHex}`, [seedHex]);

  // Last attempt info (for clean roll display + messaging)
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [lastAttemptHop, setLastAttemptHop] = useState<number | null>(null); // 1..10
  const [lastRequired, setLastRequired] = useState<number | null>(null); // success% for that hop

  // Animations / FX
  const [poppedHop, setPoppedHop] = useState<number | null>(null);
  const [bustFlash, setBustFlash] = useState<boolean>(false);
  const [hopPulse, setHopPulse] = useState<boolean>(false);

  // Outcome banner
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [outcomeText, setOutcomeText] = useState<string>("");

  // Auto-scroll
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

  // Commit UI toggle
  const [commitExpanded, setCommitExpanded] = useState<boolean>(false);

  const maxBetNote = `Max bet: ${fmtInt(MAX_BET)} DTC`;

  const nextHopIndex = hops; // 0-based next hop
  const nextHopNo = hops + 1; // 1..10

  const runEnded = isBusted || isCashedOut;

  const canStart = !hasStarted && bet > 0;
  const canHop = hasStarted && !runEnded && bet > 0 && hops < MAX_HOPS;
  const canCashOut = hasStarted && !runEnded && hops > 0;

  const nextHopSuccess = useMemo(() => {
    if (!hasStarted) return null;
    if (!canHop) return null;
    return route.success[nextHopIndex];
  }, [hasStarted, canHop, route.success, nextHopIndex]);

  const potentialPayout = useMemo(() => Math.round(bet * currentMult), [bet, currentMult]);

  function resetRun(newSeed?: number) {
    // allowed only when NOT running (we call this from “New run”)
    setHasStarted(false);

    setHops(0);
    setCurrentMult(1.0);
    setIsBusted(false);
    setIsCashedOut(false);

    setLastRoll(null);
    setLastAttemptHop(null);
    setLastRequired(null);

    setPoppedHop(null);
    setBustFlash(false);
    setHopPulse(false);

    setOutcome("idle");
    setOutcomeText("");

    setCommitExpanded(false);

    if (typeof newSeed === "number") setRngState(newSeed >>> 0);
    else setRngState(((Date.now() ^ 0x9e3779b9) >>> 0) as number);
  }

  function handleBetChange(raw: string) {
    const cleaned = raw.replace(/[^\d]/g, "");
    const n = cleaned.length ? parseInt(cleaned, 10) : 0;
    setBet(clampInt(n, 0, MAX_BET));
  }

  function setBetPreset(v: number) {
    setBet(clampInt(v, 0, MAX_BET));
  }

  function startRun() {
    if (!canStart) return;
    setHasStarted(true);
    setOutcome("idle");
    setOutcomeText("");
  }

  function hopOnce() {
    if (!canHop) return;

    const u = xorshift32(rngState);
    const roll = uint32ToRoll(u);

    const successChance = route.success[nextHopIndex];
    const passed = roll <= successChance;

    setRngState(u);
    setLastRoll(roll);
    setLastAttemptHop(nextHopNo);
    setLastRequired(successChance);

    setHopPulse(true);
    window.setTimeout(() => setHopPulse(false), 160);

    if (!passed) {
      setIsBusted(true);
      setOutcome("bust");
      setOutcomeText(`BUSTED on hop ${nextHopNo}. Roll ${roll.toFixed(3)} > ${successChance.toFixed(2)}%.`);

      setBustFlash(true);
      window.setTimeout(() => setBustFlash(false), 380);
      return;
    }

    const completedHop = nextHopNo;
    setHops(completedHop);

    const newMult = route.cashout[nextHopIndex];
    setCurrentMult(newMult);

    setOutcome("success");
    setOutcomeText(
      `Hop ${completedHop} cleared. Roll ${roll.toFixed(3)} <= ${successChance.toFixed(2)}%. Cashout now: ${fmtX(
        newMult
      )}.`
    );

    setPoppedHop(completedHop);
    window.setTimeout(() => setPoppedHop(null), 420);

    if (completedHop >= MAX_HOPS) {
      setOutcome("success");
      setOutcomeText(`Perfect run: ${MAX_HOPS}/${MAX_HOPS}. Cashout: ${fmtX(newMult)} (demo).`);
    }
  }

  function cashOut() {
    if (!canCashOut) return;
    setIsCashedOut(true);
    setOutcome("cashout");
    setOutcomeText(`Cashed out at ${fmtX(currentMult)}. Payout: ${fmtInt(potentialPayout)} DTC (demo).`);
  }

  async function copyText(txt: string) {
    try {
      await navigator.clipboard.writeText(txt);
    } catch {
      // ignore
    }
  }

  // Auto-scroll to active row on mobile (tiny polish)
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;

    const isMobile = typeof window !== "undefined" && window.innerWidth < 900;
    if (!isMobile) return;

    const targetId = isBusted
      ? `hop-row-${lastAttemptHop ?? 1}`
      : isCashedOut
      ? `hop-row-${hops}`
      : `hop-row-${Math.min(hops + 1, MAX_HOPS)}`;

    const el = document.getElementById(targetId);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [hops, isBusted, isCashedOut, lastAttemptHop]);

  const routeTitle = routeKey === "safe" ? "Safe Swamp" : routeKey === "wild" ? "Wild Swamp" : "Insane Swamp";
  const selectedChain = CHAIN_LIST.find((c) => c.key === selectedChainKey) ?? PRIMARY_CHAIN;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <style jsx global>{`
        @keyframes rowPop {
          0% { transform: scale(1); box-shadow: none; }
          45% { transform: scale(1.02); box-shadow: 0 0 0 1px rgba(16,185,129,0.35), 0 0 24px rgba(16,185,129,0.20); }
          100% { transform: scale(1); box-shadow: none; }
        }
        @keyframes bustShake {
          0% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
          100% { transform: translateX(0); }
        }
        @keyframes bustFlash {
          0% { opacity: 0; }
          25% { opacity: 0.55; }
          100% { opacity: 0; }
        }
        @keyframes hopPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
        @keyframes activeGlow {
          0%, 100% { box-shadow: 0 0 0 1px rgba(148,163,184,0.12); }
          50% { box-shadow: 0 0 0 1px rgba(148,163,184,0.18), 0 0 18px rgba(148,163,184,0.10); }
        }
      `}</style>

      {bustFlash ? (
        <div
          className="pointer-events-none fixed inset-0 z-50"
          style={{
            background: "rgba(239,68,68,0.35)",
            animation: "bustFlash 380ms ease-out forwards",
          }}
        />
      ) : null}

      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Play</h1>
              <p className="mt-2 text-neutral-300">
                Choose chain + route + bet, then press <b>START</b>. After START, settings lock until you cash out or bust.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Mode:{" "}
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/20">
                {mode}
              </span>
            </div>
          </div>

          {/* Chain selection (same style as home) */}
          <div className="mt-6 grid gap-3">
            {CHAIN_LIST.map((c) => {
              const isSelected = c.key === selectedChainKey;
              const disabled = !c.enabled || hasStarted; // lock after START
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!c.enabled) return;
                    if (hasStarted) return;
                    setSelectedChainKey(c.key);
                  }}
                  className={[
                    "text-left rounded-2xl border bg-neutral-950 p-4 transition",
                    disabled ? "cursor-not-allowed opacity-60" : "hover:bg-neutral-900/40",
                    isSelected ? "border-emerald-500/30 ring-1 ring-emerald-500/20" : "border-neutral-800",
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

                      <div className="mt-3 text-xs text-neutral-500">
                        Chain ID: {c.chainId} - Explorer:{" "}
                        <span className="text-neutral-300">{c.explorerBaseUrl.replace("https://", "")}</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <span
                        className={[
                          "rounded-xl border px-4 py-2 text-sm font-semibold",
                          isSelected
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-neutral-800 bg-neutral-900 text-neutral-400",
                        ].join(" ")}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Main play UI */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
            {/* Controls */}
            <div
              className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5"
              style={isBusted ? { animation: "bustShake 420ms ease-out" } : undefined}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-neutral-100">Controls</div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                  {mode === "DEMO" ? "DEMO" : "TOKEN"}
                </span>
              </div>

              {/* Mode selector */}
              <div className="mt-4">
                <div className="text-xs text-neutral-400">Mode</div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasStarted) return;
                      setMode("DEMO");
                    }}
                    disabled={hasStarted}
                    className={[
                      "rounded-xl border px-4 py-2 text-sm font-semibold transition",
                      mode === "DEMO"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                      hasStarted ? "cursor-not-allowed opacity-60" : "",
                    ].join(" ")}
                  >
                    DEMO
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      // token mode not implemented yet (button shown but disabled)
                    }}
                    disabled
                    className="cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-500"
                    title="Token mode will unlock later"
                  >
                    TOKEN (soon)
                  </button>
                </div>
                <div className="mt-2 text-xs text-neutral-500">
                  DEMO is free and uses local RNG. TOKEN mode will be the real wager version (later).
                </div>
              </div>

              <div className="mt-5">
                <div className="text-xs text-neutral-400">Route</div>
                <div className="mt-2 flex gap-2">
                  {ROUTES.map((r) => {
                    const active = r.key === routeKey;
                    const disabled = hasStarted; // lock after START
                    return (
                      <button
                        key={r.key}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (hasStarted) return;
                          setRouteKey(r.key);
                          resetRun(rngState);
                        }}
                        className={[
                          "rounded-xl border px-4 py-2 text-sm font-semibold transition",
                          active
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                          disabled ? "cursor-not-allowed opacity-60" : "",
                        ].join(" ")}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-neutral-500">{route.subtitle}</div>
              </div>

              <div className="mt-5">
                <div className="text-xs text-neutral-400">Bet (DTC)</div>
                <input
                  value={bet === 0 ? "" : String(bet)}
                  onChange={(e) => handleBetChange(e.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                  disabled={hasStarted}
                  className={[
                    "mt-2 w-full rounded-xl border bg-neutral-900 px-4 py-3 text-sm text-neutral-50 outline-none ring-0 placeholder:text-neutral-600 focus:border-neutral-700",
                    hasStarted ? "cursor-not-allowed border-neutral-900 opacity-60" : "border-neutral-800",
                  ].join(" ")}
                />

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={hasStarted}
                    onClick={() => setBetPreset(1_000)}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold hover:bg-neutral-800/60",
                      hasStarted ? "cursor-not-allowed border-neutral-900 text-neutral-500" : "border-neutral-800 text-neutral-100",
                    ].join(" ")}
                  >
                    1k
                  </button>
                  <button
                    type="button"
                    disabled={hasStarted}
                    onClick={() => setBetPreset(10_000)}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold hover:bg-neutral-800/60",
                      hasStarted ? "cursor-not-allowed border-neutral-900 text-neutral-500" : "border-neutral-800 text-neutral-100",
                    ].join(" ")}
                  >
                    10k
                  </button>
                  <button
                    type="button"
                    disabled={hasStarted}
                    onClick={() => setBetPreset(100_000)}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold hover:bg-neutral-800/60",
                      hasStarted ? "cursor-not-allowed border-neutral-900 text-neutral-500" : "border-neutral-800 text-neutral-100",
                    ].join(" ")}
                  >
                    100k
                  </button>
                </div>

                <div className="mt-2 text-xs text-neutral-500">{maxBetNote}</div>
                <div className="mt-1 text-xs text-neutral-600">
                  {mode === "DEMO" ? "Demo only. No transactions." : "Token mode not live yet."}
                </div>
              </div>

              {/* Run status */}
              <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Run status</div>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                    {mode}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Hops</span>
                    <span className="font-semibold">
                      {hops}/{MAX_HOPS}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Next hop success</span>
                    <span className="font-semibold">
                      {nextHopSuccess === null ? "—" : `${nextHopSuccess.toFixed(2)}%`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Bet</span>
                    <span className="font-semibold">{fmtInt(bet)} DTC</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Current cashout</span>
                    <span className="font-semibold">{hops === 0 ? "—" : fmtX(currentMult)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Potential payout</span>
                    <span className="font-semibold">{hops === 0 ? "—" : `${fmtInt(potentialPayout)} DTC`}</span>
                  </div>
                </div>

                {/* Commit (clean display) */}
                <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2 text-left text-neutral-300 hover:text-neutral-100"
                      onClick={() => setCommitExpanded((v) => !v)}
                    >
                      <span className="text-neutral-500">Commit</span>
                      <span className="font-mono text-neutral-200">
                        {commitExpanded ? commitHash : shortenHash(commitHash, 10, 10)}
                      </span>
                      <span className="text-neutral-500">{commitExpanded ? "▴" : "▾"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => copyText(commitHash)}
                      className="shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-100 hover:bg-neutral-800/60"
                    >
                      Copy
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-neutral-500">Last roll</span>
                    <span className="font-mono text-neutral-200">{formatRoll(lastRoll)}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-5 grid gap-2">
                {!hasStarted ? (
                  <button
                    type="button"
                    onClick={startRun}
                    disabled={!canStart}
                    className={[
                      "rounded-xl px-4 py-3 text-sm font-extrabold tracking-wide transition",
                      canStart
                        ? "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                        : "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500",
                    ].join(" ")}
                  >
                    START
                  </button>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={hopOnce}
                        disabled={!canHop}
                        className={[
                          "rounded-xl px-4 py-3 text-sm font-extrabold tracking-wide transition",
                          canHop
                            ? "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                            : "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500",
                        ].join(" ")}
                        style={hopPulse ? { animation: "hopPulse 160ms ease-out" } : undefined}
                      >
                        HOP
                      </button>

                      <button
                        type="button"
                        onClick={cashOut}
                        disabled={!canCashOut}
                        className={[
                          "rounded-xl px-4 py-3 text-sm font-extrabold tracking-wide transition",
                          canCashOut
                            ? "bg-neutral-50 text-neutral-950 hover:bg-white"
                            : "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500",
                        ].join(" ")}
                      >
                        CASH OUT
                      </button>
                    </div>

                    {/* New run appears only AFTER run ends (no reset mid-run) */}
                    {runEnded ? (
                      <button
                        type="button"
                        onClick={() => resetRun()}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-100 hover:bg-neutral-800/60"
                      >
                        New run
                      </button>
                    ) : null}

                    {/* After demo ends, show “play for real” option (disabled for now) */}
                    {runEnded ? (
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-neutral-500"
                        title="Token mode will unlock later"
                      >
                        Play for real (TOKEN mode coming soon)
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5" ref={tableWrapRef}>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Per-hop risk & cashout (demo table)</div>
                  <div className="mt-1 text-xs text-neutral-500">
                    UI placeholders. Later we wire to real settlement (signer / VRF / etc).
                  </div>
                </div>
                <div className="text-xs text-neutral-400">
                  Route: <span className="text-neutral-200">{routeTitle}</span>
                </div>
              </div>

              {/* Outcome banner */}
              {outcome !== "idle" ? (
                <div
                  className={[
                    "mt-4 rounded-2xl border p-3 text-sm",
                    outcome === "success"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                      : outcome === "cashout"
                      ? "border-neutral-200/15 bg-neutral-50/10 text-neutral-100"
                      : "border-red-500/20 bg-red-500/10 text-red-100",
                  ].join(" ")}
                >
                  {outcomeText}
                </div>
              ) : null}

              <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800">
                <div className="grid grid-cols-[90px_1fr_140px] bg-neutral-900/60 px-4 py-3 text-xs font-semibold text-neutral-300">
                  <div>Hop</div>
                  <div className="text-center">Success</div>
                  <div className="text-right">Cashout</div>
                </div>

                <div className="divide-y divide-neutral-800">
                  {route.success.map((p, i) => {
                    const hopNo = i + 1;

                    const isCompleted = hopNo <= hops && !isBusted;
                    const isActive = hopNo === hops + 1 && !isBusted && !isCashedOut && hops < MAX_HOPS && hasStarted;

                    const rowBase = "grid grid-cols-[90px_1fr_140px] px-4 py-3 text-sm";
                    const rowBg = isCompleted ? "bg-emerald-500/10" : isActive ? "bg-neutral-900/40" : "bg-neutral-950";

                    const popStyle = poppedHop === hopNo ? { animation: "rowPop 420ms ease-out" as const } : undefined;

                    const showRoll = lastAttemptHop === hopNo && lastRoll !== null && lastRequired !== null;

                    const showBustedChip = isBusted && lastAttemptHop === hopNo;
                    const showCashedChip = isCashedOut && hopNo === hops && hops > 0;

                    const chip = showBustedChip
                      ? { text: "❌ BUSTED", cls: "bg-red-500/10 text-red-200 ring-red-500/20" }
                      : showCashedChip
                      ? { text: "💰 CASHED", cls: "bg-neutral-50/10 text-neutral-100 ring-neutral-200/20" }
                      : null;

                    return (
                      <div
                        key={hopNo}
                        id={`hop-row-${hopNo}`}
                        className={`${rowBase} ${rowBg}`}
                        style={{
                          ...(popStyle ?? {}),
                          ...(isActive ? ({ animation: "activeGlow 1.1s ease-in-out infinite" } as const) : {}),
                        }}
                      >
                        <div className="font-semibold text-neutral-100">
                          {hopNo}
                          {chip ? (
                            <span
                              className={[
                                "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
                                chip.cls,
                              ].join(" ")}
                            >
                              {chip.text}
                            </span>
                          ) : null}
                        </div>

                        <div className="text-center">
                          <span className="font-semibold text-neutral-100">{p.toFixed(2)}%</span>
                          {showRoll ? (
                            <span className="ml-2 text-xs text-neutral-400">
                              (roll {formatRoll(lastRoll)} / need ≤ {lastRequired!.toFixed(2)}%)
                            </span>
                          ) : null}
                        </div>

                        <div className="text-right font-semibold text-neutral-100">{fmtX(route.cashout[i])}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-300">
                <b>Demo behavior:</b> No “next roll preview” is shown (prevents player-side prediction UI).
                Later we implement end-settle fairness (Intraverse-style signer / VRF, etc).
              </div>

              <div className="mt-3 text-xs text-neutral-600">
                Selected chain: <span className="text-neutral-300">{selectedChain.name}</span> ({selectedChain.enabled ? "enabled" : "disabled"})
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
