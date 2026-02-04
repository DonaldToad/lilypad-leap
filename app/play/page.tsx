"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "../components/TopNav";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import OutcomeBoard from "../components/OutcomeBoard";

type ModeKey = "safe" | "wild" | "insane";

const MAX_HOPS = 10;

// IMPORTANT: Liquidity protection
const MAX_AMOUNT = 12_000; // CHANGED from 10,000
const MIN_AMOUNT = 1;

// Sound files (served from /public)
const SOUND_BASE = "/lilypad-leap/sounds";
type SoundKey = "start" | "hop" | "busted" | "cashout" | "maxhit" | "win";
const SOUND_SRC: Record<SoundKey, string> = {
  start: `${SOUND_BASE}/start.mp3`,
  hop: `${SOUND_BASE}/hop.mp3`,
  busted: `${SOUND_BASE}/busted.mp3`,
  cashout: `${SOUND_BASE}/cashout.mp3`,
  maxhit: `${SOUND_BASE}/maxhit.mp3`,
  win: `${SOUND_BASE}/win.mp3`,
};

// Fixed per-hop success + fixed payout tables (approved)
const MODE: Record<
  ModeKey,
  {
    key: ModeKey;
    label: string;
    subtitle: string;
    pStep: number; // 0..1 (fixed per hop)
    mults: number[]; // hop 1..10 cashout multipliers
  }
> = {
  safe: {
    key: "safe",
    label: "🛡️ SAFE",
    subtitle: "Smoother curve. Lower variance.",
    pStep: 0.9,
    mults: [1.04, 1.16, 1.28, 1.43, 1.59, 1.76, 1.96, 2.18, 2.42, 2.69],
  },
  wild: {
    key: "wild",
    label: "😎 WILD",
    subtitle: "Balanced risk. Faster growth.",
    pStep: 0.82,
    mults: [1.11, 1.35, 1.65, 2.01, 2.45, 2.99, 3.64, 4.44, 5.41, 6.0],
  },
  insane: {
    key: "insane",
    label: "🐸 DEGEN",
    subtitle: "High risk. Fast multipliers.",
    pStep: 0.69,
    mults: [1.2, 1.64, 2.24, 3.06, 4.19, 5.73, 7.83, 10.7, 14.63, 20.0],
  },
};

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

// Convert uint32 -> roll in [0,100)
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

function ceilPercent(pct: number) {
  // UI-only: round up to next whole number
  return `${Math.ceil(pct)}%`;
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

// DTC icon (served from your assets repo via jsdelivr)
const DTC_ICON_SRC =
  "https://cdn.jsdelivr.net/gh/DonaldToad/dtc-assets@main/dtc-32.svg";

function DtcIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      src={DTC_ICON_SRC}
      alt="DTC"
      width={size}
      height={size}
      className="inline-block align-[-2px]"
      loading="lazy"
      decoding="async"
    />
  );
}

// Build a deterministic 32-byte-ish hex "commit hash" from a uint32 state.
// UI placeholder only — real version: keccak256(commit) stored at START, reveal at settle.
function buildCommitHash(seed: number) {
  let s = seed >>> 0;
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    s = xorshift32(s);
    parts.push(s.toString(16).padStart(8, "0"));
  }
  return `0x${parts.join("")}`;
}

// Display as first10…last10 with caret expand
function truncateHashFirstLast(h: string) {
  if (!h) return "—";
  if (h.length <= 24) return h;
  const first = h.slice(0, 12); // 0x + 10
  const last = h.slice(-10);
  return `${first}…${last}`;
}

async function copyText(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

type Outcome = "idle" | "success" | "bust" | "cashout" | "maxhit";
type AnimEvent = "idle" | "hop_ok" | "hop_fail" | "cash_out" | "max_hit";

export default function PlayPage() {
  // -----------------------------
  // Sounds (ON by default + visible toggle)
  // -----------------------------
  const [soundOn, setSoundOn] = useState<boolean>(true);
  const soundsRef = useRef<Record<SoundKey, HTMLAudioElement> | null>(null);
  const winTimerRef = useRef<number | null>(null);

  function stopAllSounds() {
    const bank = soundsRef.current;
    if (!bank) return;
    (Object.keys(bank) as SoundKey[]).forEach((k) => {
      try {
        bank[k].pause();
        bank[k].currentTime = 0;
      } catch {}
    });
  }

  function playSound(key: SoundKey, opts?: { restart?: boolean }) {
    if (!soundOn) return;
    const bank = soundsRef.current;
    if (!bank) return;
    const a = bank[key];
    if (!a) return;

    try {
      if (opts?.restart !== false) a.currentTime = 0;
      // Must be called after a user gesture for some browsers — we only call on clicks.
      void a.play();
    } catch {
      // ignore (autoplay restrictions, etc.)
    }
  }

  useEffect(() => {
    // Create audio objects once on client
    const bank: Record<SoundKey, HTMLAudioElement> = {
      start: new Audio(SOUND_SRC.start),
      hop: new Audio(SOUND_SRC.hop),
      busted: new Audio(SOUND_SRC.busted),
      cashout: new Audio(SOUND_SRC.cashout),
      maxhit: new Audio(SOUND_SRC.maxhit),
      win: new Audio(SOUND_SRC.win),
    };

    // Light preload
    (Object.keys(bank) as SoundKey[]).forEach((k) => {
      bank[k].preload = "auto";
      bank[k].volume = 0.9;
    });

    soundsRef.current = bank;

    return () => {
      if (winTimerRef.current) window.clearTimeout(winTimerRef.current);
      winTimerRef.current = null;
      try {
        stopAllSounds();
      } catch {}
      soundsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // When user mutes: stop any playing audio immediately
    if (!soundOn) stopAllSounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn]);

  // Chain selection (UI-only demo)
  const [selectedChainKey, setSelectedChainKey] = useState<string>(PRIMARY_CHAIN.key);

  // Mode selection
  const [modeKey, setModeKey] = useState<ModeKey>("safe");
  const mode = MODE[modeKey];

  // Amount input
  const [amount, setAmount] = useState<number>(1000);
  const [amountRaw, setAmountRaw] = useState<string>("1000");
  const [maxClampNotice, setMaxClampNotice] = useState<boolean>(false);

  // Run lifecycle
  const [hasStarted, setHasStarted] = useState<boolean>(false);
  const [hops, setHops] = useState<number>(0); // completed hops
  const [currentMult, setCurrentMult] = useState<number>(1.0);
  const [isFailed, setIsFailed] = useState<boolean>(false);
  const [isCashedOut, setIsCashedOut] = useState<boolean>(false);

  // RNG state
  const [rngState, setRngState] = useState<number>(() => (Date.now() ^ 0x6a41f7f5) >>> 0);

  // Commit hash
  const commitHash = useMemo(() => buildCommitHash(rngState), [rngState]);
  const [commitExpanded, setCommitExpanded] = useState(false);
  const [commitCopied, setCommitCopied] = useState(false);

  // Last attempt info
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [lastAttemptHop, setLastAttemptHop] = useState<number | null>(null); // 1..10
  const [lastRequiredPct, setLastRequiredPct] = useState<number | null>(null); // exact %

  // Visual FX
  const [poppedHop, setPoppedHop] = useState<number | null>(null);
  const [failFlash, setFailFlash] = useState<boolean>(false);
  const [hopPulse, setHopPulse] = useState<boolean>(false);

  // Outcome banner
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [outcomeText, setOutcomeText] = useState<string>("");

  // Animation hooks
  const [animEvent, setAnimEvent] = useState<AnimEvent>("idle");
  const [animNonce, setAnimNonce] = useState<number>(0); // bump to “trigger” effects

  // Action lock (prevents spam until animation finishes)
  const [actionLocked, setActionLocked] = useState<boolean>(false);
  const lockTimerRef = useRef<number | null>(null);

  // Table expansion (mobile-friendly)
  const [showAllSteps, setShowAllSteps] = useState<boolean>(true);

  // Scroll helper
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

  // Scroll target = Outcome board / canvas (where the toad is)
  const boardScrollRef = useRef<HTMLDivElement | null>(null);

  // Remember last amount used at START, so PLAY AGAIN can reuse it
  const lastStartedAmountRef = useRef<number>(1000);

  // Derived tables for this mode (fixed)
  const multTable = useMemo(() => mode.mults, [modeKey]);

  // Exact per-step success % used by game math
  const stepSuccessPctExact = useMemo(() => mode.pStep * 100, [mode.pStep]);

  // Next hop info
  const nextHopIndex = hops; // 0-based
  const nextHopNo = hops + 1;

  const maxHit = hasStarted && !isFailed && hops >= MAX_HOPS;

  // IMPORTANT: allow Cash Out at hop 10
  const canStart = !hasStarted && amount >= MIN_AMOUNT;
  const canHop = hasStarted && !isFailed && !isCashedOut && !actionLocked && hops < MAX_HOPS;
  const canCashOut = hasStarted && !isFailed && !isCashedOut && !actionLocked && hops > 0; // includes hops==10

  const ended = isFailed || isCashedOut;

  const currentReturn = useMemo(() => Math.floor(amount * currentMult), [amount, currentMult]);

  const nextHopSuccessExact = useMemo(() => {
    if (!canHop) return null;
    return stepSuccessPctExact;
  }, [canHop, stepSuccessPctExact]);

  // Values for the top strip (current + next)
  const currentPrize = useMemo(() => {
    if (!hasStarted) return 0;
    return Math.floor(amount * (hops === 0 ? 1.0 : currentMult));
  }, [hasStarted, amount, hops, currentMult]);

  const nextMult = useMemo(() => {
    if (!hasStarted) return null;
    if (hops >= MAX_HOPS) return null;
    return multTable[nextHopIndex];
  }, [hasStarted, hops, multTable, nextHopIndex]);

  const nextPrize = useMemo(() => {
    if (nextMult === null) return null;
    return Math.floor(amount * nextMult);
  }, [amount, nextMult]);

  // Busted display for top CURRENT strip
  const topCurrentMult = useMemo(() => {
    if (!hasStarted) return null;
    if (isFailed) return 0;
    return hops === 0 ? 1.0 : currentMult;
  }, [hasStarted, isFailed, hops, currentMult]);

  const topCurrentPrize = useMemo(() => {
    if (!hasStarted) return null;
    if (isFailed) return 0;
    return currentPrize;
  }, [hasStarted, isFailed, currentPrize]);

  // Default table behavior: show all on desktop, collapsed on mobile
  useEffect(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 900;
    setShowAllSteps(!isMobile);
  }, []);

  // Clear any outstanding lock timer on unmount
  useEffect(() => {
    return () => {
      if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;

      if (winTimerRef.current) window.clearTimeout(winTimerRef.current);
      winTimerRef.current = null;
    };
  }, []);

  function lockActions(ms: number) {
    if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;

    if (ms <= 0) {
      setActionLocked(false);
      return;
    }

    setActionLocked(true);
    lockTimerRef.current = window.setTimeout(() => {
      setActionLocked(false);
      lockTimerRef.current = null;
    }, ms);
  }

  // Mobile scroll to Outcome Board (MetaMask-friendly)
  function scrollToBoard() {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 900;
    if (!isMobile) return;

    const el = boardScrollRef.current;
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  function triggerAnim(ev: AnimEvent) {
    setAnimEvent(ev);
    setAnimNonce((n) => n + 1);

    // Dopamine beat: lock buttons until the “moment” finishes
    const ms =
      ev === "hop_ok"
        ? 260
        : ev === "hop_fail"
        ? 520
        : ev === "cash_out"
        ? 520
        : ev === "max_hit"
        ? 680
        : 0;

    lockActions(ms);
  }

  function resetRunNewSeed() {
    // Stop any queued WIN sound
    if (winTimerRef.current) window.clearTimeout(winTimerRef.current);
    winTimerRef.current = null;

    const newSeed = ((Date.now() ^ 0x9e3779b9) >>> 0) as number;
    setRngState(newSeed);

    setHasStarted(false);
    setHops(0);
    setCurrentMult(1.0);
    setIsFailed(false);
    setIsCashedOut(false);

    setLastRoll(null);
    setLastAttemptHop(null);
    setLastRequiredPct(null);

    setPoppedHop(null);
    setFailFlash(false);
    setHopPulse(false);

    setOutcome("idle");
    setOutcomeText("");

    setCommitExpanded(false);
    setCommitCopied(false);

    setAnimEvent("idle");
    setAnimNonce((n) => n + 1);

    lockActions(0);
  }

  // "PLAY AGAIN" uses previous started amount, and starts immediately
  function playAgainSameAmount() {
    const v = clampInt(lastStartedAmountRef.current || amount, MIN_AMOUNT, MAX_AMOUNT);
    setAmount(v);
    setAmountRaw(String(v));
    resetRunNewSeed();
    window.setTimeout(() => {
      startRun();
    }, 0);
  }

  // "CHANGE AMOUNT" ends the run but preserves the last used amount in input for editing
  function changeAmountFlow() {
    resetRunNewSeed();
    window.setTimeout(() => scrollToBoard(), 60);
  }

  function sanitizeAndSetAmount(nextRaw: string) {
    // Locked after START
    if (hasStarted) return;

    // Keep raw for UX, but sanitize
    const cleaned = nextRaw.replace(/[^\d]/g, "");
    setAmountRaw(cleaned);

    if (!cleaned.length) {
      setAmount(0);
      return;
    }

    const parsed = parseInt(cleaned, 10);
    const clamped = clampInt(parsed, MIN_AMOUNT, MAX_AMOUNT);

    if (parsed > MAX_AMOUNT) {
      setMaxClampNotice(true);
      window.setTimeout(() => setMaxClampNotice(false), 1400);
    }

    setAmount(clamped);
    setAmountRaw(String(clamped));
  }

  function setAmountPreset(v: number) {
    if (hasStarted) return;
    const clamped = clampInt(v, MIN_AMOUNT, MAX_AMOUNT);
    setAmount(clamped);
    setAmountRaw(String(clamped));
  }

  function startRun() {
    if (!canStart) return;

    // Ensure amount is valid
    const clamped = clampInt(amount || MIN_AMOUNT, MIN_AMOUNT, MAX_AMOUNT);
    setAmount(clamped);
    setAmountRaw(String(clamped));

    // Remember this amount for PLAY AGAIN
    lastStartedAmountRef.current = clamped;

    setHasStarted(true);
    setOutcome("idle");
    setOutcomeText("");

    // ✅ START sound
    playSound("start");

    // Mobile: bring the board into view (not the buttons)
    window.setTimeout(() => scrollToBoard(), 60);
  }

  function hopOnce() {
    if (!canHop) return;

    // ✅ HOP sound (action feedback)
    playSound("hop");

    const u = xorshift32(rngState);
    const roll = uint32ToRoll(u);

    // Success test uses exact probability (NOT rounded UI)
    const successPct = stepSuccessPctExact;
    const passed = roll <= successPct;

    setRngState(u);
    setLastRoll(roll);
    setLastAttemptHop(nextHopNo);
    setLastRequiredPct(successPct);

    setHopPulse(true);
    window.setTimeout(() => setHopPulse(false), 160);

    if (!passed) {
      setIsFailed(true);
      setOutcome("bust");
      setOutcomeText(
        `Failed on hop ${nextHopNo}. Roll ${roll.toFixed(3)} > ${successPct.toFixed(6)}%.`
      );

      setFailFlash(true);
      window.setTimeout(() => setFailFlash(false), 380);

      // ✅ BUSTED sound
      playSound("busted");

      triggerAnim("hop_fail");

      window.setTimeout(() => scrollToBoard(), 80);
      return;
    }

    // Passed
    const completedHop = nextHopNo;
    setHops(completedHop);

    const newMult = multTable[nextHopIndex];
    setCurrentMult(newMult);

    setOutcome("success");
    setOutcomeText(
      `Hop ${completedHop} cleared. Roll ${roll.toFixed(3)} ≤ ${successPct.toFixed(
        6
      )}%. Cash Out now: ${fmtX(newMult)}.`
    );

    setPoppedHop(completedHop);
    window.setTimeout(() => setPoppedHop(null), 420);

    triggerAnim("hop_ok");

    // MAX HIT reached
    if (completedHop >= MAX_HOPS) {
      setOutcome("maxhit");
      setOutcomeText(
        `MAX HIT achieved: ${MAX_HOPS}/${MAX_HOPS}. Cash Out available at ${fmtX(newMult)}.`
      );

      // ✅ MAXHIT sound, then WIN right after
      playSound("maxhit");
      if (winTimerRef.current) window.clearTimeout(winTimerRef.current);
      winTimerRef.current = window.setTimeout(() => {
        playSound("win");
        winTimerRef.current = null;
      }, 450);

      triggerAnim("max_hit");
    }

    window.setTimeout(() => scrollToBoard(), 90);
  }

  function cashOut() {
    if (!canCashOut) return;

    setIsCashedOut(true);
    setOutcome("cashout");
    setOutcomeText(
      `Cash Out at ${fmtX(currentMult)}. Estimated return: ${fmtInt(currentReturn)} DTC (demo).`
    );

    // ✅ CASHOUT sound
    playSound("cashout");

    triggerAnim("cash_out");

    window.setTimeout(() => scrollToBoard(), 90);
  }

  // Auto-scroll to relevant row on mobile (table)
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;

    const isMobile = typeof window !== "undefined" && window.innerWidth < 900;
    if (!isMobile) return;

    const targetId = isFailed
      ? `hop-row-${lastAttemptHop ?? 1}`
      : isCashedOut
      ? `hop-row-${hops}`
      : `hop-row-${Math.min(hops + 1, MAX_HOPS)}`;

    const el = document.getElementById(targetId);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [hops, isFailed, isCashedOut, lastAttemptHop]);

  // Ensure mobile scroll prefers the OUTCOME BOARD (toad) on key state changes
  useEffect(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 900;
    if (!isMobile) return;
    window.setTimeout(() => scrollToBoard(), 80);
  }, [hasStarted, hops, isFailed, isCashedOut, actionLocked, animEvent, animNonce]);

  const selectedChain = CHAIN_LIST.find((c) => c.key === selectedChainKey) ?? PRIMARY_CHAIN;

  // Visible hop rows (mobile-friendly collapse)
  const visibleHopSet = useMemo(() => {
    if (showAllSteps)
      return new Set<number>(Array.from({ length: MAX_HOPS }, (_, i) => i + 1));

    const s = new Set<number>();

    if (!hasStarted) {
      s.add(1);
      s.add(2);
      return s;
    }

    if (isFailed) {
      const h = lastAttemptHop ?? 1;
      s.add(Math.max(1, h - 1));
      s.add(h);
      s.add(Math.min(MAX_HOPS, h + 1));
      return s;
    }

    if (hops <= 0) {
      s.add(1);
      s.add(2);
      return s;
    }

    if (hops >= MAX_HOPS) {
      s.add(MAX_HOPS - 1);
      s.add(MAX_HOPS);
      return s;
    }

    s.add(Math.max(1, hops - 1));
    s.add(hops);
    s.add(hops + 1);
    return s;
  }, [showAllSteps, hasStarted, isFailed, lastAttemptHop, hops]);

  // 2 lilypads “no assets” look classes
  const padFxClass =
    animEvent === "hop_ok"
      ? "padFxOk"
      : animEvent === "hop_fail"
      ? "padFxFail"
      : animEvent === "cash_out"
      ? "padFxCash"
      : animEvent === "max_hit"
      ? "padFxMax"
      : "";

  const modeToneClass =
    modeKey === "safe" ? "toneSafe" : modeKey === "wild" ? "toneWild" : "toneInsane";

  // ✅ BELOW-CANVAS CTA FIX:
  // - Default: single button that reads START then HOP (normal run flow)
  // - Only after CASH OUT or BUSTED: swap to 2-button layout (PLAY AGAIN + CHANGE AMOUNT)
  const showPostOutcomeButtons = ended;

  const bottomPrimaryLabel = useMemo(() => {
    if (!hasStarted) return "START";
    if (hops >= MAX_HOPS) return "CASH OUT";
    return "HOP";
  }, [hasStarted, hops]);

  const bottomPrimaryDisabled = useMemo(() => {
    if (!hasStarted) return !canStart;
    if (hops >= MAX_HOPS) return !canCashOut;
    return !canHop;
  }, [hasStarted, canStart, hops, canCashOut, canHop]);

  function onBottomPrimary() {
    if (!hasStarted) {
      startRun();
      return;
    }
    if (hops >= MAX_HOPS) {
      cashOut();
      return;
    }
    hopOnce();
  }

  const bottomHint = useMemo(() => {
    if (showPostOutcomeButtons) return "Busted or cashed out — choose your next move.";
    if (!hasStarted) return "Start a run.";
    if (hops >= MAX_HOPS) return "MAX HIT — cash out to lock it in.";
    return actionLocked ? "…" : "Primary action.";
  }, [showPostOutcomeButtons, hasStarted, hops, actionLocked]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <style jsx global>{`
        @keyframes rowPop {
          0% {
            transform: scale(1);
            box-shadow: none;
          }
          45% {
            transform: scale(1.02);
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.35), 0 0 24px rgba(16, 185, 129, 0.2);
          }
          100% {
            transform: scale(1);
            box-shadow: none;
          }
        }
        @keyframes failShake {
          0% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-6px);
          }
          40% {
            transform: translateX(6px);
          }
          60% {
            transform: translateX(-5px);
          }
          80% {
            transform: translateX(5px);
          }
          100% {
            transform: translateX(0);
          }
        }
        @keyframes failFlash {
          0% {
            opacity: 0;
          }
          25% {
            opacity: 0.55;
          }
          100% {
            opacity: 0;
          }
        }
        @keyframes hopPulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.03);
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes activeGlow {
          0%,
          100% {
            box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.12);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.18), 0 0 18px rgba(148, 163, 184, 0.1);
          }
        }

        /* --- Lilypad FX (no assets) --- */
        @keyframes padBob {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-2px);
          }
        }
        @keyframes padRipple {
          0% {
            transform: translate(-50%, -50%) scale(0.7);
            opacity: 0;
          }
          15% {
            opacity: 0.28;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.55);
            opacity: 0;
          }
        }
        @keyframes padOk {
          0% {
            transform: translateY(0) scale(1);
          }
          55% {
            transform: translateY(-2px) scale(1.01);
          }
          100% {
            transform: translateY(0) scale(1);
          }
        }
        @keyframes padFail {
          0% {
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
          60% {
            transform: translateY(2px) scale(0.995);
            filter: saturate(0.8);
          }
          100% {
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
        }
        @keyframes padCash {
          0% {
            box-shadow: 0 0 0 rgba(16, 185, 129, 0);
          }
          50% {
            box-shadow: 0 0 32px rgba(16, 185, 129, 0.18);
          }
          100% {
            box-shadow: 0 0 0 rgba(16, 185, 129, 0);
          }
        }
        @keyframes padMax {
          0% {
            box-shadow: 0 0 0 rgba(250, 204, 21, 0);
          }
          45% {
            box-shadow: 0 0 48px rgba(250, 204, 21, 0.22);
          }
          100% {
            box-shadow: 0 0 0 rgba(250, 204, 21, 0);
          }
        }

        /* Tone backgrounds for the canvas container */
        .toneSafe {
          background: radial-gradient(circle at 50% 15%, rgba(56, 189, 248, 0.14), transparent 55%),
            radial-gradient(circle at 25% 85%, rgba(34, 197, 94, 0.12), transparent 55%),
            linear-gradient(180deg, rgba(2, 6, 23, 0.55), rgba(2, 6, 23, 0.25));
        }
        .toneWild {
          background: radial-gradient(circle at 50% 15%, rgba(168, 85, 247, 0.16), transparent 55%),
            radial-gradient(circle at 25% 85%, rgba(34, 197, 94, 0.1), transparent 55%),
            linear-gradient(180deg, rgba(2, 6, 23, 0.55), rgba(2, 6, 23, 0.25));
        }
        .toneInsane {
          background: radial-gradient(circle at 50% 15%, rgba(244, 63, 94, 0.16), transparent 55%),
            radial-gradient(circle at 25% 85%, rgba(250, 204, 21, 0.12), transparent 55%),
            linear-gradient(180deg, rgba(2, 6, 23, 0.55), rgba(2, 6, 23, 0.25));
        }

        /* Event FX class applied to pad wrapper divs */
        .padFxOk {
          animation: padOk 260ms ease-out;
        }
        .padFxFail {
          animation: padFail 520ms ease-out;
        }
        .padFxCash {
          animation: padCash 520ms ease-out;
        }
        .padFxMax {
          animation: padMax 680ms ease-out;
        }
      `}</style>

      {failFlash ? (
        <div
          className="pointer-events-none fixed inset-0 z-50"
          style={{
            background: "rgba(239,68,68,0.35)",
            animation: "failFlash 380ms ease-out forwards",
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
                Choose a route, set an amount, then decide: <b>HOP</b> or <b>CASH OUT</b> — up to <b>10 hops</b>.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-200 ring-1 ring-emerald-500/20">
                  DEMO: Local simulation
                </span>
                <span className="rounded-full bg-neutral-50/10 px-2 py-0.5 font-semibold text-neutral-100 ring-1 ring-neutral-200/20">
                  TOKEN: Next step (on-chain amounts)
                </span>
              </div>
            </div>

            <div className="text-sm text-neutral-400">
              Primary: <span className="text-neutral-100">{PRIMARY_CHAIN.name}</span>
            </div>
          </div>

          {/* Chain selection (compact switch) */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-semibold text-neutral-100">Network</div>

              <div className="flex w-full max-w-xl items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900/40 p-1">
                {CHAIN_LIST.map((c) => {
                  const isSelected = c.key === selectedChainKey;
                  const isDisabled = c.enabled === false;

                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => {
                        if (isDisabled) return;
                        setSelectedChainKey(c.key);
                      }}
                      disabled={isDisabled}
                      className={[
                        "flex flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition",
                        isDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-neutral-800/40",
                        isSelected
                          ? "bg-neutral-950 ring-1 ring-emerald-500/20 border border-emerald-500/20"
                          : "border border-transparent",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <ChainIcon chainKey={c.key} alt={`${c.name} icon`} />
                        <div className="leading-tight">
                          <div className="text-sm font-semibold text-neutral-100">{c.name}</div>
                          <div className="text-[11px] text-neutral-500">Chain ID: {c.chainId}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={
                            c.statusTag === "LIVE"
                              ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/20"
                              : "rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/20"
                          }
                        >
                          {c.statusTag}
                        </span>

                        {c.isPrimary ? (
                          <span className="hidden rounded-full bg-neutral-800/60 px-2 py-0.5 text-[11px] font-semibold text-neutral-200 ring-1 ring-neutral-700 md:inline">
                            PRIMARY
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 text-xs text-neutral-500">{selectedChain.note}</div>
          </div>

          {/* Main play UI */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
            {/* Controls */}
            <div
              className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5"
              style={isFailed ? { animation: "failShake 420ms ease-out" } : undefined}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-neutral-100">Demo Controls</div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/20">
                  DEMO
                </span>
              </div>

              {/* Sound toggle */}
              <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-neutral-200">Sound</div>
                    <div className="mt-0.5 text-[11px] text-neutral-500">
                      {soundOn ? "ON (default)" : "OFF (muted)"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSoundOn((v) => !v)}
                    className={[
                      "rounded-xl border px-3 py-2 text-xs font-extrabold tracking-wide transition",
                      soundOn
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                        : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                    ].join(" ")}
                  >
                    {soundOn ? "SOUND: ON" : "SOUND: OFF"}
                  </button>
                </div>
              </div>

              {/* Mode */}
              <div className="mt-4">
                <div className="text-xs text-neutral-400">Route</div>
                <div className="mt-2 flex gap-2">
                  {(Object.keys(MODE) as ModeKey[]).map((k) => {
                    const r = MODE[k];
                    const active = r.key === modeKey;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => {
                          if (hasStarted) return;
                          setModeKey(r.key);
                        }}
                        className={[
                          "rounded-xl border px-4 py-2 text-sm font-semibold transition",
                          hasStarted ? "opacity-60 cursor-not-allowed" : "",
                          active
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                        ].join(" ")}
                        disabled={hasStarted}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-neutral-500">{mode.subtitle}</div>
              </div>

              {/* Amount */}
              <div className="mt-5">
                <div className="text-xs text-neutral-400">Amount (DTC)</div>
                <input
                  value={amountRaw}
                  onChange={(e) => sanitizeAndSetAmount(e.target.value)}
                  inputMode="numeric"
                  placeholder={`${MIN_AMOUNT}`}
                  disabled={hasStarted}
                  className={[
                    "mt-2 w-full rounded-xl border bg-neutral-900 px-4 py-3 text-sm text-neutral-50 outline-none ring-0 placeholder:text-neutral-600",
                    hasStarted
                      ? "cursor-not-allowed border-neutral-900 opacity-60"
                      : "border-neutral-800 focus:border-neutral-700",
                  ].join(" ")}
                />

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAmountPreset(1_000)}
                    disabled={hasStarted}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100",
                      hasStarted
                        ? "cursor-not-allowed border-neutral-900 opacity-60"
                        : "border-neutral-800 hover:bg-neutral-800/60",
                    ].join(" ")}
                  >
                    1,000 <DtcIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmountPreset(5_000)}
                    disabled={hasStarted}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100",
                      hasStarted
                        ? "cursor-not-allowed border-neutral-900 opacity-60"
                        : "border-neutral-800 hover:bg-neutral-800/60",
                    ].join(" ")}
                  >
                    5,000 <DtcIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmountPreset(12_000)}
                    disabled={hasStarted}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100",
                      hasStarted
                        ? "cursor-not-allowed border-neutral-900 opacity-60"
                        : "border-neutral-800 hover:bg-neutral-800/60",
                    ].join(" ")}
                  >
                    12,000 <DtcIcon />
                  </button>
                </div>

                <div className="mt-2 text-xs text-neutral-500">
                  Max game = {fmtInt(MAX_AMOUNT)} <DtcIcon size={12} />
                </div>
                <div className="mt-1 text-xs text-neutral-600">
                  {hasStarted ? "Locked after START." : "Set before START."}
                </div>

                {maxClampNotice ? (
                  <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    Max game = {fmtInt(MAX_AMOUNT)} <DtcIcon size={12} />
                  </div>
                ) : null}
              </div>

              {/* Run status */}
              <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Run status</div>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                    DEMO
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">State</span>
                    <span className="font-semibold">
                      {!hasStarted
                        ? "Not started"
                        : isFailed
                        ? "FAILED"
                        : isCashedOut
                        ? "CASHED OUT"
                        : maxHit
                        ? "MAX HIT"
                        : actionLocked
                        ? "Animating…"
                        : "In run"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Hops</span>
                    <span className="font-semibold">
                      {hops}/{MAX_HOPS}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Next hop success</span>
                    <span className="font-semibold">
                      {nextHopSuccessExact === null
                        ? "—"
                        : `${ceilPercent(nextHopSuccessExact)} (exact ${nextHopSuccessExact.toFixed(
                            6
                          )}%)`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Amount</span>
                    <span className="font-semibold">
                      {fmtInt(amount)}{" "}
                      <span className="ml-1">
                        <DtcIcon size={12} />
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Cash Out now</span>
                    <span className="font-semibold">{hops === 0 ? "—" : fmtX(currentMult)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Estimated return</span>
                    <span className="font-semibold">
                      {hops === 0 ? "—" : `${fmtInt(currentReturn)} DTC`}
                    </span>
                  </div>
                </div>

                {/* Commit + last roll */}
                <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
                  <button
                    type="button"
                    onClick={async () => {
                      setCommitExpanded((v) => !v);
                      const ok = await copyText(commitHash);
                      if (ok) {
                        setCommitCopied(true);
                        window.setTimeout(() => setCommitCopied(false), 900);
                      }
                    }}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-neutral-500">Commit hash</span>
                      <span className="text-neutral-600">{commitCopied ? "copied" : commitExpanded ? "▴" : "▾"}</span>
                    </div>

                    <div className="mt-1 break-all font-mono text-neutral-200">
                      {commitExpanded ? commitHash : truncateHashFirstLast(commitHash)}
                    </div>

                    <div className="mt-1 text-[11px] text-neutral-600">
                      Demo placeholder. Real mode: commit stored at START, reveal only at settle.
                    </div>
                  </button>

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

                    {ended ? (
                      <button
                        type="button"
                        onClick={resetRunNewSeed}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-100 hover:bg-neutral-800/60"
                      >
                        NEW RUN
                      </button>
                    ) : null}
                  </>
                )}

                {/* Token mode CTA (future) */}
                <div className="mt-2 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 text-xs text-neutral-300">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">TOKEN mode</span>
                    <span className="rounded-full bg-neutral-50/10 px-2 py-0.5 text-[11px] font-semibold text-neutral-100 ring-1 ring-neutral-200/20">
                      SOON
                    </span>
                  </div>
                  <div className="mt-2 text-neutral-400">
                    After demo polish + animations, we’ll enable on-chain amounts (trusted signer, settle once at the end).
                  </div>
                  <button
                    type="button"
                    disabled
                    className="mt-2 w-full cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-semibold text-neutral-500"
                  >
                    Play for real (coming soon)
                  </button>
                </div>
              </div>
            </div>

            {/* Right side: Animation + Table */}
            <div className="grid gap-6" ref={tableWrapRef}>
              {/* Animation canvas */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-sm font-semibold text-neutral-100">Animation Canvas</div>
                    <div className="mt-1 text-xs text-neutral-500">Two lilypads only • event-driven FX</div>
                  </div>
                  <div className="text-xs text-neutral-400">
                    Chain: <span className="text-neutral-200">{selectedChain.name}</span> (UI)
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30">
                  <div
                    ref={boardScrollRef}
                    className={`relative w-full ${modeToneClass}`}
                    style={{
                      paddingTop: "64%",
                      minHeight: 420,
                    }}
                  >
                    {/* Water + lilypads (no assets) */}
                    <div className="absolute inset-0">
                      <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/20 via-neutral-950/10 to-neutral-950/30" />
                      <div
                        className="absolute inset-0 opacity-[0.06]"
                        style={{
                          backgroundImage:
                            "radial-gradient(circle at 20% 20%, #fff 0 1px, transparent 2px), radial-gradient(circle at 80% 30%, #fff 0 1px, transparent 2px), radial-gradient(circle at 40% 75%, #fff 0 1px, transparent 2px)",
                          backgroundSize: "220px 220px",
                        }}
                      />

                      {/* Pad A (current) */}
                      <div className={`absolute left-[14%] bottom-[14%] h-[32%] w-[44%] ${padFxClass}`}>
                        <div
                          className="absolute inset-0 rounded-[999px] border border-emerald-300/10"
                          style={{
                            background:
                              "radial-gradient(circle at 35% 35%, rgba(34,197,94,0.22), rgba(34,197,94,0.10) 45%, rgba(16,185,129,0.05) 70%, rgba(0,0,0,0) 100%)",
                            boxShadow:
                              "inset 0 0 0 1px rgba(16,185,129,0.08), 0 10px 30px rgba(0,0,0,0.35)",
                            animation: "padBob 1.8s ease-in-out infinite",
                          }}
                        />
                        <div
                          className="absolute left-1/2 top-1/2 h-[68%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-[999px] border border-neutral-50/10"
                          style={{
                            background:
                              "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 60%, rgba(0,0,0,0) 100%)",
                          }}
                        />
                        <div
                          className="absolute left-1/2 top-1/2 h-[120%] w-[120%] rounded-[999px] border border-neutral-50/10"
                          style={{
                            transform: "translate(-50%, -50%)",
                            animation: animEvent === "hop_ok" || animEvent === "hop_fail" ? "padRipple 520ms ease-out" : "none",
                          }}
                        />
                      </div>

                      {/* Pad B (next) */}
                      <div className={`absolute right-[12%] bottom-[22%] h-[24%] w-[34%] ${padFxClass}`}>
                        <div
                          className="absolute inset-0 rounded-[999px] border border-emerald-300/10"
                          style={{
                            background:
                              "radial-gradient(circle at 40% 40%, rgba(34,197,94,0.18), rgba(34,197,94,0.08) 50%, rgba(16,185,129,0.03) 75%, rgba(0,0,0,0) 100%)",
                            boxShadow:
                              "inset 0 0 0 1px rgba(16,185,129,0.06), 0 8px 24px rgba(0,0,0,0.32)",
                            animation: "padBob 2.1s ease-in-out infinite",
                          }}
                        />
                        {hops >= MAX_HOPS - 1 ? (
                          <div
                            className="absolute inset-0 rounded-[999px]"
                            style={{
                              boxShadow:
                                animEvent === "max_hit" || outcome === "maxhit"
                                  ? "0 0 0 1px rgba(250,204,21,0.25), 0 0 38px rgba(250,204,21,0.18)"
                                  : "0 0 0 1px rgba(250,204,21,0.14)",
                            }}
                          />
                        ) : null}
                      </div>
                    </div>

                    {/* Top hop strip (current + next: multiplier + payout) */}
                    <div className="absolute left-0 right-0 top-0 z-20 p-3">
                      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2 rounded-2xl border border-neutral-800 bg-neutral-950/55 px-3 py-2 backdrop-blur">
                        <div className="min-w-0 flex-1 rounded-xl bg-neutral-50/5 px-3 py-2 ring-1 ring-neutral-200/10">
                          <div className="text-[11px] font-semibold text-neutral-400">CURRENT</div>
                          <div className="mt-0.5 flex items-baseline justify-between gap-2">
                            <div className={["text-sm font-extrabold", isFailed ? "text-red-200" : "text-neutral-100"].join(" ")}>
                              {topCurrentMult === null ? "—" : topCurrentMult === 0 ? "0.00x" : fmtX(topCurrentMult)}
                            </div>

                            <div className={["text-sm font-extrabold", isFailed ? "text-red-300" : "text-emerald-200"].join(" ")}>
                              {topCurrentPrize === null ? "—" : `${fmtInt(topCurrentPrize)} DTC`}
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-500">
                            {hasStarted ? `Hop ${Math.min(hops, MAX_HOPS)}/${MAX_HOPS}` : "Not started"}
                          </div>
                        </div>

                        <div className="min-w-0 flex-1 rounded-xl bg-neutral-50/5 px-3 py-2 ring-1 ring-neutral-200/10">
                          <div className="text-[11px] font-semibold text-neutral-400">NEXT</div>
                          <div className="mt-0.5 flex items-baseline justify-between gap-2">
                            <div className="text-sm font-extrabold text-neutral-100">{nextMult === null ? "—" : fmtX(nextMult)}</div>
                            <div className="text-sm font-extrabold text-emerald-200">
                              {nextPrize === null ? "—" : `${fmtInt(nextPrize)} DTC`}
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-500">
                            {nextMult === null ? (hops >= MAX_HOPS ? "MAX HIT reached" : "—") : `If hop ${Math.min(hops + 1, MAX_HOPS)} clears`}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Board layer */}
                    <div key={`${animEvent}-${animNonce}`} className="absolute inset-0 z-10">
                      <OutcomeBoard
                        outcome={outcome}
                        animEvent={animEvent}
                        animNonce={animNonce}
                        hops={hops}
                        maxHops={MAX_HOPS}
                        currentMult={currentMult}
                        currentReturn={currentReturn}
                        modeKey={modeKey}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ✅ PRIMARY CTA under Canvas (FIXED SEQUENCE) */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                {!showPostOutcomeButtons ? (
                  <button
                    type="button"
                    onClick={onBottomPrimary}
                    disabled={bottomPrimaryDisabled}
                    className={[
                      "w-full rounded-2xl px-4 py-4 text-base font-extrabold tracking-wide transition",
                      bottomPrimaryDisabled
                        ? "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500"
                        : "bg-emerald-500 text-neutral-950 hover:bg-emerald-400",
                    ].join(" ")}
                    style={hopPulse ? { animation: "hopPulse 160ms ease-out" } : undefined}
                  >
                    {bottomPrimaryLabel}
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={playAgainSameAmount}
                      className="rounded-2xl px-4 py-4 text-base font-extrabold tracking-wide transition bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                    >
                      PLAY AGAIN
                    </button>

                    <button
                      type="button"
                      onClick={changeAmountFlow}
                      className="rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-4 text-base font-extrabold tracking-wide text-neutral-100 hover:bg-neutral-800/60"
                    >
                      CHANGE AMOUNT
                    </button>
                  </div>
                )}

                <div className="mt-2 text-center text-[11px] text-neutral-500">{bottomHint}</div>
              </div>

              {/* Outcome banner */}
              {outcome !== "idle" ? (
                <div
                  className={[
                    "rounded-2xl border p-3 text-sm",
                    outcome === "success"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                      : outcome === "cashout"
                      ? "border-neutral-200/15 bg-neutral-50/10 text-neutral-100"
                      : outcome === "maxhit"
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                      : "border-red-500/20 bg-red-500/10 text-red-100",
                  ].join(" ")}
                >
                  {outcomeText}
                </div>
              ) : null}

              {/* Table */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-sm font-semibold text-neutral-100">Steps (demo math table)</div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Success is fixed per mode; UI shows rounded-up whole %, but math uses exact precision.
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAllSteps((v) => !v)}
                      className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100 hover:bg-neutral-800/60"
                    >
                      {showAllSteps ? "Collapse" : "Show all"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800">
                  <div className="grid grid-cols-[90px_1fr_140px] bg-neutral-900/60 px-4 py-3 text-xs font-semibold text-neutral-300">
                    <div>Hop</div>
                    <div className="text-center">Success (fixed)</div>
                    <div className="text-right">Cash Out</div>
                  </div>

                  <div className="divide-y divide-neutral-800">
                    {Array.from({ length: MAX_HOPS }, (_, idx) => {
                      const hopNo = idx + 1;
                      if (!visibleHopSet.has(hopNo)) return null;

                      const isCompleted = hopNo <= hops && !isFailed;
                      const isActive =
                        hopNo === hops + 1 && !isFailed && !isCashedOut && hasStarted && hops < MAX_HOPS;

                      const rowBase = "grid grid-cols-[90px_1fr_140px] px-4 py-3 text-sm";
                      const rowBg = isCompleted ? "bg-emerald-500/10" : isActive ? "bg-neutral-900/40" : "bg-neutral-950";

                      const popStyle =
                        poppedHop === hopNo ? { animation: "rowPop 420ms ease-out" as const } : undefined;

                      const showRoll = lastAttemptHop === hopNo && lastRoll !== null && lastRequiredPct !== null;

                      const clearedVisible = isCompleted && hops >= 2 && hopNo > Math.max(0, hops - 3);

                      const showFailedChip = isFailed && lastAttemptHop === hopNo;
                      const showCashedChip = isCashedOut && hopNo === hops && hops > 0;
                      const showMaxHitChip = !isFailed && hopNo === MAX_HOPS && hops >= MAX_HOPS;

                      const chip = showFailedChip
                        ? { text: "❌ FAILED", cls: "bg-red-500/10 text-red-200 ring-red-500/20" }
                        : showCashedChip
                        ? { text: "💰 CASHED", cls: "bg-neutral-50/10 text-neutral-100 ring-neutral-200/20" }
                        : showMaxHitChip
                        ? { text: "🏆 MAX HIT", cls: "bg-emerald-500/10 text-emerald-200 ring-emerald-500/20" }
                        : clearedVisible
                        ? { text: "✅ CLEARED", cls: "bg-emerald-500/10 text-emerald-200 ring-emerald-500/20" }
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
                            <span className="font-semibold text-neutral-100">{ceilPercent(stepSuccessPctExact)}</span>

                            {showRoll ? (
                              <span className="ml-2 text-xs text-neutral-400">
                                (roll {formatRoll(lastRoll)} / need ≤ {lastRequiredPct!.toFixed(6)}%)
                              </span>
                            ) : null}
                          </div>

                          <div className="text-right font-semibold text-neutral-100">{fmtX(multTable[idx])}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-300">
                  <b>Demo guarantee:</b> The UI does not reveal future outcomes. Rolls are computed and displayed only after an attempt.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-neutral-600">
            Selected chain: <span className="text-neutral-300">{selectedChain.name}</span> (UI only)
          </div>
        </div>
      </section>
    </main>
  );
}
