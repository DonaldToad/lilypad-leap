"use client";

import React, { useMemo } from "react";

type Outcome = "idle" | "success" | "bust" | "cashout" | "maxhit";
type AnimEvent = "idle" | "hop_ok" | "hop_fail" | "cash_out" | "max_hit";

// modeKey values come from the Play page
type ModeKey = "safe" | "wild" | "insane";

// Keep in sync with Play page MODE config (mult tables + pStep)
const MODE_META: Record<ModeKey, { emoji: string; name: string; pStep: number; mults: number[] }> = {
  safe: {
    emoji: "🛡️",
    name: "SAFE",
    pStep: 0.9,
    mults: [1.04, 1.16, 1.28, 1.43, 1.59, 1.76, 1.96, 2.18, 2.42, 2.69],
  },
  wild: {
    emoji: "😎",
    name: "WILD",
    pStep: 0.82,
    mults: [1.11, 1.35, 1.65, 2.01, 2.45, 2.99, 3.64, 4.44, 5.41, 6.0],
  },
  insane: {
    emoji: "🐸",
    name: "DEGEN",
    pStep: 0.69,
    mults: [1.2, 1.64, 2.24, 3.06, 4.19, 5.73, 7.83, 10.7, 14.63, 20.0],
  },
};

function fmtInt(n: number) {
  return Math.floor(n).toLocaleString("en-US");
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// Smoothly shift from green->red as hops increase (UI only)
function hopHue(t: number) {
  // 145° (emerald-ish) down to 0° (red)
  const start = 145;
  const end = 0;
  return Math.round(start + (end - start) * clamp01(t));
}

function canShare(n: Navigator): n is Navigator & { share: (data: { title?: string; text?: string; url?: string }) => Promise<void> } {
  return typeof (n as any).share === "function";
}

type CSSVars = React.CSSProperties & {
  ["--dx"]?: string;
  ["--dy"]?: string;
};

export default function OutcomeBoard(props: {
  outcome: Outcome;
  animEvent: AnimEvent;
  animNonce: number;
  hops: number;
  maxHops: number;
  currentMult: number;
  currentReturn: number;
  modeKey: ModeKey;
}) {
  const { outcome, animEvent, animNonce, hops, maxHops, currentMult, currentReturn, modeKey } = props;

  const modeMeta = useMemo(() => MODE_META[modeKey], [modeKey]);

  // Which “moment” to render (prioritize anim event so the board matches the exact click)
  const moment: Outcome = useMemo(() => {
    if (animEvent === "hop_fail") return "bust";
    if (animEvent === "cash_out") return "cashout";
    if (animEvent === "max_hit") return "maxhit";
    if (animEvent === "hop_ok") return "success";
    return outcome;
  }, [animEvent, outcome]);

  const nextChancePct = useMemo(() => `${Math.ceil(modeMeta.pStep * 100)}%`, [modeMeta]);

  // CURRENT display: turns to 0 on busted
  const currentMultDisplay = useMemo(() => (moment === "bust" ? 0 : currentMult), [moment, currentMult]);
  const currentReturnDisplay = useMemo(() => (moment === "bust" ? 0 : currentReturn), [moment, currentReturn]);

  // Estimate base amount so we can compute NEXT payout locally (since we only receive currentReturn/currentMult)
  const estAmount = useMemo(() => {
    if (!Number.isFinite(currentMult) || currentMult <= 0) return 0;
    return Math.max(0, Math.round(currentReturn / currentMult));
  }, [currentReturn, currentMult]);

  const nextMult = useMemo(() => {
    if (hops >= maxHops) return null;
    return modeMeta.mults[hops] ?? null;
  }, [hops, maxHops, modeMeta]);

  const nextReturn = useMemo(() => {
    if (nextMult === null) return null;
    return Math.floor(estAmount * nextMult);
  }, [estAmount, nextMult]);

  const rightBoxTitle = moment === "cashout" || moment === "maxhit" ? "🏆 PRIZE" : "NEXT";

  const rightMultDisplay = useMemo(() => {
    if (moment === "cashout" || moment === "maxhit") return currentMult;
    return nextMult ?? null;
  }, [moment, currentMult, nextMult]);

  const rightReturnDisplay = useMemo(() => {
    if (moment === "cashout" || moment === "maxhit") return currentReturn;
    return nextReturn ?? null;
  }, [moment, currentReturn, nextReturn]);

  const rightSubline = useMemo(() => {
    if (moment === "cashout" || moment === "maxhit") return "Locked";
    if (rightMultDisplay === null) return hops >= maxHops ? "Run complete" : "—";
    return `If hop ${Math.min(hops + 1, maxHops)} clears`;
  }, [moment, rightMultDisplay, hops, maxHops]);

  // Headline / subline
  const headline =
    moment === "success"
      ? "HOP!"
      : moment === "cashout"
      ? "CASHED OUT"
      : moment === "maxhit"
      ? "MAX HIT!"
      : moment === "bust"
      ? "BUSTED"
      : "READY";

  const subline =
    moment === "success"
      ? `Cleared hop ${Math.min(hops, maxHops)}/${maxHops}`
      : moment === "cashout"
      ? `Locked at ${currentMult.toFixed(2)}x`
      : moment === "maxhit"
      ? `Cleared ${maxHops}/${maxHops}`
      : moment === "bust"
      ? `Failed on hop ${Math.min(hops + 1, maxHops)}/${maxHops}`
      : `Start when you're ready`;

  const toadSrc = useMemo(() => {
    const base = "/lilypad-leap/toad/";
    if (moment === "bust") return base + "busted.png";
    if (moment === "cashout") return base + "cashout.png";
    if (moment === "maxhit") return base + "maxhit.png";
    if (moment === "success") return base + "hop.png";
    return base + "idle.png";
  }, [moment]);

  // Progress bar % (0..100)
  const progressPct = useMemo(() => Math.max(0, Math.min(100, (hops / maxHops) * 100)), [hops, maxHops]);

  // ✅ Color rules:
  // - Starts green, shifts toward red as hops increase
  // - If busted: always red
  // - If cashout or maxhit: always green
  const barStyle = useMemo<React.CSSProperties>(() => {
    if (moment === "bust") return { backgroundColor: "hsl(0 84% 55%)" };
    if (moment === "cashout" || moment === "maxhit") return { backgroundColor: "hsl(145 76% 45%)" };

    const t = maxHops <= 0 ? 0 : hops / maxHops; // 0..1
    const hue = hopHue(t);
    return { backgroundColor: `hsl(${hue} 78% 50%)` };
  }, [moment, hops, maxHops]);

  const pctTextClass =
    moment === "bust"
      ? "text-red-200"
      : moment === "cashout" || moment === "maxhit"
      ? "text-emerald-200"
      : "text-neutral-300";

  const showShare = moment === "cashout" || moment === "maxhit";
  const showConfetti = moment === "maxhit";
  const showLightning = moment === "maxhit";
  const showCoinSplash = moment === "cashout";
  const showBustFlash = moment === "bust";

  async function shareResult() {
    const modeLabel = `${modeMeta.emoji} ${modeMeta.name}`;
    const title = "Lilypad Leap";
    const text = `${title} — ${modeLabel}\n${headline}: ${currentMult.toFixed(2)}x = ${fmtInt(
      currentReturn
    )} DTC\nProgress: ${Math.min(hops, maxHops)}/${maxHops}`;

    try {
      if (canShare(navigator)) {
        await navigator.share({ title, text });
        return;
      }
    } catch {
      // fallthrough to clipboard
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // ignore
    }

    // last-resort fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      // ignore
    }
  }

  return (
    <div className="relative h-full w-full">
      <style jsx>{`
        @keyframes floaty {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-3px);
          }
        }

        @keyframes popIn {
          0% {
            transform: translateY(8px) scale(0.99);
            opacity: 0;
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }

        /* Max hit: small screen shake */
        @keyframes maxShake {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          10% {
            transform: translate3d(-1px, 0, 0);
          }
          20% {
            transform: translate3d(2px, -1px, 0);
          }
          30% {
            transform: translate3d(-2px, 1px, 0);
          }
          40% {
            transform: translate3d(1px, 0, 0);
          }
          50% {
            transform: translate3d(-1px, -1px, 0);
          }
          60% {
            transform: translate3d(2px, 1px, 0);
          }
          70% {
            transform: translate3d(-2px, 0, 0);
          }
          80% {
            transform: translate3d(1px, 1px, 0);
          }
          90% {
            transform: translate3d(-1px, 0, 0);
          }
        }

        /* Lightning flicker overlay */
        @keyframes lightningFlicker {
          0%,
          100% {
            opacity: 0;
            transform: scale(1);
          }
          6% {
            opacity: 0.95;
          }
          12% {
            opacity: 0.15;
          }
          18% {
            opacity: 0.85;
            transform: scale(1.01);
          }
          28% {
            opacity: 0.25;
          }
          38% {
            opacity: 0.7;
          }
          50% {
            opacity: 0.05;
          }
          60% {
            opacity: 0.55;
          }
          72% {
            opacity: 0.12;
          }
        }

        /* Confetti (simple + light) */
        @keyframes confettiFall {
          0% {
            transform: translateY(-18px) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          100% {
            transform: translateY(140px) rotate(220deg);
            opacity: 0;
          }
        }

        /* Cashout: coins splash */
        @keyframes coinBurst {
          0% {
            transform: translate3d(0, 0, 0) scale(0.6);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          100% {
            transform: translate3d(var(--dx), var(--dy), 0) scale(1);
            opacity: 0;
          }
        }

        /* Busted: quick red flash */
        @keyframes bustFlash {
          0% {
            opacity: 0;
          }
          15% {
            opacity: 0.55;
          }
          100% {
            opacity: 0;
          }
        }

        .fx-card {
          animation: popIn 180ms ease-out;
        }
        .fx-max {
          animation: popIn 180ms ease-out, maxShake 480ms ease-out;
        }

        .fx-lightning {
          position: absolute;
          inset: 0;
          border-radius: 24px;
          pointer-events: none;
          mix-blend-mode: screen;
          background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 55%),
            radial-gradient(circle at 70% 25%, rgba(250, 204, 21, 0.35), rgba(250, 204, 21, 0) 60%),
            linear-gradient(135deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.16) 25%, rgba(255, 255, 255, 0) 55%),
            linear-gradient(45deg, rgba(255, 255, 255, 0) 0%, rgba(250, 204, 21, 0.14) 30%, rgba(255, 255, 255, 0) 62%);
          animation: lightningFlicker 900ms ease-out 1;
        }

        .fx-bustFlash {
          position: absolute;
          inset: -2px;
          border-radius: 28px;
          pointer-events: none;
          background: rgba(239, 68, 68, 0.35);
          animation: bustFlash 380ms ease-out 1;
        }

        .fx-confetti {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          border-radius: 28px;
        }
        .fx-confetti span {
          position: absolute;
          top: -10px;
          width: 8px;
          height: 14px;
          border-radius: 3px;
          opacity: 0;
          animation: confettiFall 980ms ease-out 1;
        }

        .fx-coins {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          border-radius: 28px;
        }
        .fx-coins i {
          position: absolute;
          right: 26px;
          bottom: 26px;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.85), rgba(250, 204, 21, 0.9) 45%, rgba(250, 204, 21, 0.35) 75%);
          box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.22);
          opacity: 0;
          animation: coinBurst 650ms ease-out 1;
        }

        @media (prefers-reduced-motion: reduce) {
          .fx-card,
          .fx-max,
          .fx-lightning,
          .fx-confetti span,
          .fx-coins i,
          .fx-bustFlash {
            animation: none !important;
          }
        }
      `}</style>

      {/* Big board: occupies the canvas area */}
      <div className="absolute inset-0 flex items-center justify-center px-4 py-4 md:px-6 md:py-6">
        <div
          key={`card-${animNonce}`}
          className={[
            "relative w-full max-w-3xl rounded-3xl border border-neutral-800 bg-neutral-950/60",
            "p-4 md:p-6",
            moment === "maxhit"
              ? "ring-1 ring-emerald-500/25"
              : moment === "cashout"
              ? "ring-1 ring-neutral-200/15"
              : moment === "bust"
              ? "ring-1 ring-red-500/25"
              : moment === "success"
              ? "ring-1 ring-emerald-500/20"
              : "",
            moment === "maxhit" ? "fx-max" : "fx-card",
          ].join(" ")}
        >
          {/* soft tint */}
          <div
            className={[
              "pointer-events-none absolute inset-0 rounded-3xl",
              moment === "bust" ? "bg-red-500/10" : "bg-emerald-500/10",
            ].join(" ")}
          />

          {/* FX layers */}
          {showBustFlash ? <div className="fx-bustFlash" /> : null}
          {showLightning ? <div key={`light-${animNonce}`} className="fx-lightning" /> : null}

          {showConfetti ? (
            <div key={`conf-${animNonce}`} className="fx-confetti">
              {Array.from({ length: 22 }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    left: `${(i * 4.5) % 100}%`,
                    animationDelay: `${(i % 6) * 40}ms`,
                    background:
                      i % 4 === 0
                        ? "rgba(250,204,21,0.9)"
                        : i % 4 === 1
                        ? "rgba(16,185,129,0.9)"
                        : i % 4 === 2
                        ? "rgba(244,63,94,0.9)"
                        : "rgba(59,130,246,0.9)",
                    transform: `rotate(${(i * 19) % 180}deg)`,
                  }}
                />
              ))}
            </div>
          ) : null}

          {showCoinSplash ? (
            <div key={`coin-${animNonce}`} className="fx-coins">
              {Array.from({ length: 14 }).map((_, i) => {
                const ang = (i / 14) * Math.PI * 1.15 + 0.2; // mostly upward/left
                const dist = 34 + (i % 5) * 14;
                const dx = Math.round(Math.cos(ang) * dist) * -1;
                const dy = Math.round(Math.sin(ang) * dist) * -1;

                const style: CSSVars = {
                  animationDelay: `${(i % 7) * 26}ms`,
                  ["--dx"]: `${dx}px`,
                  ["--dy"]: `${dy}px`,
                };

                return <i key={i} style={style} />;
              })}
            </div>
          ) : null}

          {/* TOP BOXES: CURRENT | NEXT CHANCE | PROGRESS */}
          <div className="relative grid grid-cols-3 gap-2 md:gap-3">
            {/* CURRENT */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/55 px-3 py-2">
              <div className="text-[11px] font-semibold text-neutral-400">CURRENT</div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3">
                <div className={["text-sm font-extrabold", moment === "bust" ? "text-red-200" : "text-neutral-100"].join(" ")}>
                  {currentMultDisplay.toFixed(2)}x
                </div>
                <div className={["text-sm font-extrabold", moment === "bust" ? "text-red-300" : "text-emerald-200"].join(" ")}>
                  {fmtInt(currentReturnDisplay)} DTC
                </div>
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                Hop {Math.max(1, Math.min(hops, maxHops))}/{maxHops}
              </div>
            </div>

            {/* NEXT CHANCE */}
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-emerald-200/80">
                <span>NEXT CHANCE</span>
                <span className="text-emerald-200/75">
                  {modeMeta.emoji} {modeMeta.name}
                </span>
              </div>
              <div className="mt-0.5 text-sm font-extrabold text-emerald-200">{nextChancePct}</div>
            </div>

            {/* PROGRESS */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/55 px-3 py-2 text-right">
              <div className="text-[11px] font-semibold text-neutral-400">PROGRESS</div>
              <div className="mt-0.5 text-sm font-extrabold text-neutral-100">
                {Math.min(hops, maxHops)}/{maxHops}
              </div>
            </div>
          </div>

          {/* MAIN: TOAD + MESSAGE */}
          <div className="relative mt-4 flex items-center gap-4 md:mt-5">
            <img
              src={toadSrc}
              alt="toad"
              width={240}
              height={240}
              className="h-[185px] w-[185px] md:h-[220px] md:w-[220px]"
              style={{ animation: "floaty 1.9s ease-in-out infinite" }}
              draggable={false}
            />

            <div className="min-w-0">
              <div className="text-4xl font-extrabold tracking-tight text-neutral-50 md:text-6xl">{headline}</div>
              <div className="mt-1 text-sm font-semibold text-neutral-200 md:text-base">{subline}</div>

              {showShare ? (
                <button
                  type="button"
                  onClick={shareResult}
                  className="mt-3 inline-flex items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-xs font-extrabold tracking-wide text-emerald-200 hover:bg-emerald-500/15"
                >
                  SHARE
                </button>
              ) : null}
            </div>
          </div>

          {/* BOTTOM ROW: Progress (left) + NEXT/PRIZE (right) */}
          <div className="relative mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_260px] md:items-stretch md:gap-4">
            {/* Progress bar card (narrower height) */}
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
                <span>Progress</span>
                <span className={pctTextClass}>{Math.round(progressPct)}%</span>
              </div>

              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${progressPct}%`, transition: "width 240ms ease-out", ...barStyle }} />
              </div>
            </div>

            {/* NEXT / PRIZE box */}
            <div className="relative rounded-2xl border border-neutral-800 bg-neutral-950/55 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-neutral-400">{rightBoxTitle}</div>
                <div className="text-[11px] font-semibold text-neutral-500">{rightSubline}</div>
              </div>

              <div className="mt-1 flex items-baseline justify-between gap-3">
                <div className="text-sm font-extrabold text-neutral-100">
                  {rightMultDisplay === null ? "—" : `${rightMultDisplay.toFixed(2)}x`}
                </div>
                <div className="text-sm font-extrabold text-emerald-200">
                  {rightReturnDisplay === null ? "—" : `${fmtInt(rightReturnDisplay)} DTC`}
                </div>
              </div>

              <div className="mt-1 text-[11px] text-neutral-500">
                {rightBoxTitle === "NEXT" ? (rightMultDisplay === null ? "—" : rightSubline) : "Final result"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
