"use client";

import { useMemo, useState } from "react";

type Outcome = "idle" | "success" | "bust" | "cashout" | "maxhit";
type AnimEvent = "idle" | "hop_ok" | "hop_fail" | "cash_out" | "max_hit";

export default function OutcomeBoard(props: {
  outcome: Outcome;
  animEvent: AnimEvent;
  animNonce: number;
  hops: number;
  maxHops: number;
  currentMult: number;
  currentReturn: number;
  modeKey: "safe" | "wild" | "insane";
}) {
  const { outcome, animEvent, animNonce, hops, maxHops, currentMult, currentReturn, modeKey } = props;

  const moment: Outcome = useMemo(() => {
    if (animEvent === "hop_fail") return "bust";
    if (animEvent === "cash_out") return "cashout";
    if (animEvent === "max_hit") return "maxhit";
    if (animEvent === "hop_ok") return "success";
    return outcome;
  }, [animEvent, outcome]);

  const src = useMemo(() => {
    const base = "/lilypad-leap/toad/";
    if (moment === "bust") return base + "busted.png";
    if (moment === "cashout") return base + "cashout.png";
    if (moment === "maxhit") return base + "maxhit.png";
    if (moment === "success") return base + "hop.png";
    return base + "idle.png";
  }, [moment]);

  const tone = modeKey === "safe" ? "tone-safe" : modeKey === "wild" ? "tone-wild" : "tone-degen";

  const title =
    moment === "maxhit"
      ? "MAX HIT"
      : moment === "cashout"
      ? "CASH OUT"
      : moment === "bust"
      ? "BUSTED"
      : moment === "success"
      ? "HOP!"
      : "READY";

  const hopShown = useMemo(() => {
    // When busted, you failed the *next* hop attempt
    if (moment === "bust") return Math.min(hops + 1, maxHops);
    return Math.min(hops, maxHops);
  }, [moment, hops, maxHops]);

  const subtitle =
    title === "MAX HIT"
      ? `${maxHops}/${maxHops} • ${currentMult.toFixed(2)}x`
      : title === "CASH OUT"
      ? `${currentMult.toFixed(2)}x • ~${currentReturn.toLocaleString("en-US")} DTC`
      : title === "BUSTED"
      ? `Hop ${hopShown} didn’t land. Try again 🐸`
      : title === "HOP!"
      ? `Cleared hop ${hopShown}/${maxHops}`
      : `Press HOP or CASH OUT`;

  const modeChipText = modeKey === "insane" ? "DEGEN" : modeKey.toUpperCase();

  // Progress
  const pct = useMemo(() => {
    const raw = maxHops > 0 ? (Math.min(Math.max(hops, 0), maxHops) / maxHops) * 100 : 0;
    // For BUSTED, you usually want to show progress up to the last cleared hop (hops)
    return Math.max(0, Math.min(100, raw));
  }, [hops, maxHops]);

  // Bar color logic:
  // - cashout/maxhit => green
  // - bust => red
  // - otherwise shifts toward red as pct increases (risk vibe)
  const barColor = useMemo(() => {
    if (moment === "maxhit" || moment === "cashout") return "rgb(16,185,129)"; // emerald-500
    if (moment === "bust") return "rgb(239,68,68)"; // red-500

    // shift green -> red based on progress
    const t = Math.max(0, Math.min(1, pct / 100));
    const r = Math.round(16 + (239 - 16) * t);
    const g = Math.round(185 + (68 - 185) * t);
    const b = Math.round(129 + (68 - 129) * t);
    return `rgb(${r},${g},${b})`;
  }, [moment, pct]);

  const showShare = moment === "cashout" || moment === "maxhit";

  const shareText = useMemo(() => {
    const amt = currentReturn.toLocaleString("en-US");
    const m = currentMult.toFixed(2);
    const modeLabel = modeKey === "insane" ? "DEGEN" : modeKey.toUpperCase();
    return `🐸 Lilypad Leap\n✅ ${modeLabel} • ${hops}/${maxHops}\n💰 Cash Out: ${m}x (~${amt} DTC)\n#DonaldToadCoin #LilypadLeap`;
  }, [currentReturn, currentMult, modeKey, hops, maxHops]);

  const [shareToast, setShareToast] = useState<string>("");

  async function doShare() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Lilypad Leap",
          text: shareText,
        });
        return;
      }
    } catch {
      // ignore and fallback to clipboard
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setShareToast("Copied!");
      window.setTimeout(() => setShareToast(""), 900);
    } catch {
      setShareToast("Copy failed");
      window.setTimeout(() => setShareToast(""), 900);
    }
  }

  // FX classes (no setState-in-effect; animNonce is used to retrigger via key)
  const cardFx =
    moment === "maxhit"
      ? "fx-max"
      : moment === "cashout"
      ? "fx-cash"
      : moment === "bust"
      ? "fx-bust"
      : moment === "success"
      ? "fx-hop"
      : "fx-idle";

  const showBustFlash = moment === "bust";
  const showConfetti = moment === "maxhit";
  const showSparkles = moment === "cashout";

  return (
    <div className={`relative h-full w-full ${tone}`}>
      {/* BUST flash overlay */}
      {showBustFlash ? <div key={`flash-${animNonce}`} className="abs fx-bust-flash" /> : null}

      {/* background glow */}
      <div className="absolute inset-0 opacity-70 blur-2xl">
        <div className="mx-auto mt-10 h-40 w-40 rounded-full bg-white/10" />
      </div>

      {/* board (moved DOWN so top strip never covers it) */}
      <div className="absolute inset-0 flex items-start justify-center px-4 pt-20 md:pt-24">
        <div key={`card-${animNonce}`} className={`relative w-full max-w-2xl rounded-3xl border border-neutral-800 bg-neutral-950/60 p-5 md:p-6 ${cardFx}`}>
          {/* confetti / sparkles overlays */}
          {showConfetti ? <div key={`conf-${animNonce}`} className="abs fx-confetti" /> : null}
          {showSparkles ? <div key={`sp-${animNonce}`} className="abs fx-sparkles" /> : null}

          <div className="flex items-center gap-4 md:gap-6">
            {/* Bigger toad */}
            <img
              src={src}
              alt="toad"
              width={260}
              height={260}
              className="pixel h-36 w-36 md:h-44 md:w-44 lg:h-48 lg:w-48 select-none"
              draggable={false}
            />

            <div className="min-w-0 flex-1">
              <div className="text-3xl md:text-4xl font-extrabold tracking-wide text-neutral-50">{title}</div>
              <div className="mt-2 text-sm md:text-base text-neutral-300">{subtitle}</div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                <span className="rounded-full bg-neutral-50/10 px-2 py-0.5 ring-1 ring-neutral-200/15">{modeChipText}</span>
                <span className="rounded-full bg-neutral-50/10 px-2 py-0.5 ring-1 ring-neutral-200/15">
                  {Math.min(hops, maxHops)}/{maxHops}
                </span>

                {moment === "maxhit" ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-200 ring-1 ring-emerald-500/20">
                    🏆 FULL CLEAR
                  </span>
                ) : null}
              </div>

              {/* SHARE (wins only, green) */}
              {showShare ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={doShare}
                    className="w-full rounded-2xl bg-emerald-500 px-4 py-4 text-base font-extrabold tracking-wide text-neutral-950 hover:bg-emerald-400"
                  >
                    SHARE
                  </button>
                  {shareToast ? <div className="mt-2 text-center text-xs text-neutral-400">{shareToast}</div> : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* Progress */}
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>Progress</span>
              <span className={moment === "bust" ? "text-red-200 font-semibold" : moment === "cashout" || moment === "maxhit" ? "text-emerald-200 font-semibold" : ""}>
                {Math.round(pct)}%
              </span>
            </div>

            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: barColor,
                  boxShadow:
                    moment === "maxhit" || moment === "cashout"
                      ? "0 0 22px rgba(16,185,129,0.18)"
                      : moment === "bust"
                      ? "0 0 22px rgba(239,68,68,0.18)"
                      : "0 0 16px rgba(148,163,184,0.10)",
                  transition: "width 240ms ease-out, background 240ms ease-out",
                }}
              />
            </div>

            <div className="mt-2 text-xs text-neutral-500">
              {moment === "maxhit"
                ? "Max win achieved — fully safe (green)."
                : moment === "cashout"
                ? "Cashed out — locked in (green)."
                : moment === "bust"
                ? "Busted — run ended (red)."
                : "Gets riskier as you go (shifts toward red)."}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .abs {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .pixel {
          image-rendering: pixelated;
          image-rendering: crisp-edges;
          -ms-interpolation-mode: nearest-neighbor;
        }

        .tone-safe {
          background: radial-gradient(circle at 50% 30%, rgba(56, 189, 248, 0.14), transparent 55%),
            radial-gradient(circle at 30% 80%, rgba(34, 197, 94, 0.1), transparent 55%);
        }
        .tone-wild {
          background: radial-gradient(circle at 50% 30%, rgba(168, 85, 247, 0.16), transparent 55%),
            radial-gradient(circle at 30% 80%, rgba(34, 197, 94, 0.1), transparent 55%);
        }
        .tone-degen {
          background: radial-gradient(circle at 50% 30%, rgba(244, 63, 94, 0.16), transparent 55%),
            radial-gradient(circle at 30% 80%, rgba(250, 204, 21, 0.1), transparent 55%);
        }

        /* Card FX */
        .fx-idle {
          animation: idleBob 1.6s ease-in-out infinite;
        }
        .fx-hop {
          animation: hopPop 240ms ease-out;
        }
        .fx-cash {
          animation: cashStamp 360ms cubic-bezier(0.2, 1.2, 0.2, 1);
        }
        .fx-max {
          animation: maxGlow 520ms ease-out;
        }
        .fx-bust {
          animation: bustShake 420ms ease-out;
          border-color: rgba(239, 68, 68, 0.25);
        }

        @keyframes idleBob {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-2px);
          }
        }
        @keyframes hopPop {
          0% {
            transform: scale(0.985);
          }
          60% {
            transform: scale(1.02);
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes cashStamp {
          0% {
            transform: scale(0.94);
            opacity: 0.75;
          }
          70% {
            transform: scale(1.05);
            opacity: 1;
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes maxGlow {
          0% {
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.15), 0 0 0 rgba(16, 185, 129, 0);
          }
          45% {
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.28), 0 0 40px rgba(16, 185, 129, 0.18);
          }
          100% {
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.15), 0 0 0 rgba(16, 185, 129, 0);
          }
        }
        @keyframes bustShake {
          0% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-8px);
          }
          40% {
            transform: translateX(8px);
          }
          60% {
            transform: translateX(-6px);
          }
          80% {
            transform: translateX(6px);
          }
          100% {
            transform: translateX(0);
          }
        }

        /* BUST flash overlay */
        .fx-bust-flash {
          background: rgba(239, 68, 68, 0.28);
          animation: bustFlash 420ms ease-out forwards;
        }
        @keyframes bustFlash {
          0% {
            opacity: 0;
          }
          20% {
            opacity: 0.7;
          }
          100% {
            opacity: 0;
          }
        }

        /* Sparkles overlay (cash out) */
        .fx-sparkles {
          background-image: radial-gradient(circle at 20% 30%, rgba(255, 255, 255, 0.25) 0 2px, transparent 3px),
            radial-gradient(circle at 70% 40%, rgba(255, 255, 255, 0.18) 0 2px, transparent 3px),
            radial-gradient(circle at 40% 75%, rgba(255, 255, 255, 0.22) 0 2px, transparent 3px),
            radial-gradient(circle at 85% 70%, rgba(255, 255, 255, 0.16) 0 2px, transparent 3px);
          opacity: 0;
          animation: sparkles 700ms ease-out forwards;
          filter: blur(0.2px);
        }
        @keyframes sparkles {
          0% {
            opacity: 0;
            transform: scale(0.98);
          }
          20% {
            opacity: 0.75;
          }
          100% {
            opacity: 0;
            transform: scale(1.02);
          }
        }

        /* Confetti overlay (max hit) */
        .fx-confetti {
          opacity: 0;
          animation: confetti 900ms ease-out forwards;
          background-image: radial-gradient(circle at 12% 10%, rgba(250, 204, 21, 0.8) 0 2px, transparent 3px),
            radial-gradient(circle at 25% 22%, rgba(34, 197, 94, 0.8) 0 2px, transparent 3px),
            radial-gradient(circle at 45% 12%, rgba(56, 189, 248, 0.8) 0 2px, transparent 3px),
            radial-gradient(circle at 65% 18%, rgba(168, 85, 247, 0.8) 0 2px, transparent 3px),
            radial-gradient(circle at 80% 8%, rgba(239, 68, 68, 0.75) 0 2px, transparent 3px),
            radial-gradient(circle at 18% 40%, rgba(250, 204, 21, 0.7) 0 2px, transparent 3px),
            radial-gradient(circle at 62% 38%, rgba(34, 197, 94, 0.65) 0 2px, transparent 3px),
            radial-gradient(circle at 86% 44%, rgba(56, 189, 248, 0.7) 0 2px, transparent 3px);
          background-size: 100% 100%;
          filter: blur(0.1px);
        }
        @keyframes confetti {
          0% {
            opacity: 0;
            transform: translateY(-8px);
          }
          20% {
            opacity: 0.9;
          }
          100% {
            opacity: 0;
            transform: translateY(10px);
          }
        }
      `}</style>
    </div>
  );
}
