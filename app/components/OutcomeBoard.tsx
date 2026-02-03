"use client";

import { useEffect, useMemo, useState } from "react";

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

  // Pick image by event first (more “moment” driven), fallback to outcome
  const src = useMemo(() => {
    const base = "/lilypad-leap/toad/";
    if (animEvent === "hop_fail") return base + "busted.png";
    if (animEvent === "cash_out") return base + "cashout.png";
    if (animEvent === "max_hit") return base + "maxhit.png";
    if (animEvent === "hop_ok") return base + "hop.png";

    if (outcome === "bust") return base + "busted.png";
    if (outcome === "cashout") return base + "cashout.png";
    if (outcome === "maxhit") return base + "maxhit.png";
    if (outcome === "success") return base + "hop.png";
    return base + "idle.png";
  }, [animEvent, outcome]);

  // Small FX class that triggers on animNonce
  const [fx, setFx] = useState<string>("");

  useEffect(() => {
    // reset + apply one-shot class
    // (use timeouts so re-trigger works reliably)
    setFx("");
    const t = window.setTimeout(() => {
      if (animEvent === "hop_ok") setFx("fx-shake");
      else if (animEvent === "hop_fail") setFx("fx-sink");
      else if (animEvent === "cash_out") setFx("fx-stamp");
      else if (animEvent === "max_hit") setFx("fx-strobe");
      else setFx("fx-idle");
    }, 10);

    return () => window.clearTimeout(t);
  }, [animNonce, animEvent]);

  // Mode tone (very cheap “feel” shift)
  const tone = modeKey === "safe" ? "tone-safe" : modeKey === "wild" ? "tone-wild" : "tone-insane";

  const title =
    animEvent === "max_hit" || outcome === "maxhit"
      ? "MAX HIT"
      : animEvent === "cash_out" || outcome === "cashout"
      ? "CASH OUT"
      : animEvent === "hop_fail" || outcome === "bust"
      ? "BUSTED"
      : animEvent === "hop_ok" || outcome === "success"
      ? "HOP!"
      : "READY";

  const subtitle =
    title === "MAX HIT"
      ? `${maxHops}/${maxHops} • ${currentMult.toFixed(2)}x`
      : title === "CASH OUT"
      ? `${currentMult.toFixed(2)}x • ~${currentReturn.toLocaleString("en-US")} DTC`
      : title === "BUSTED"
      ? `Hop ${Math.min(hops + 1, maxHops)} didn’t land. Try again 🐸`
      : title === "HOP!"
      ? `Cleared hop ${hops}/${maxHops}`
      : `Press HOP or CASH OUT`;

  return (
    <div className={`relative h-full w-full ${tone}`}>
      {/* background glow */}
      <div className="absolute inset-0 opacity-70 blur-2xl">
        <div className="mx-auto mt-10 h-40 w-40 rounded-full bg-white/10" />
      </div>

      {/* board */}
      <div className={`absolute inset-0 flex items-center justify-center p-4`}>
        <div className={`w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 ${fx}`}>
          <div className="flex items-center gap-4">
            <img
              src={src}
              alt="toad"
              width={160}
              height={160}
              className="pixel h-28 w-28 select-none"
              draggable={false}
            />

            <div className="min-w-0">
              <div className="text-lg font-extrabold tracking-wide text-neutral-50">{title}</div>
              <div className="mt-1 text-xs text-neutral-300">{subtitle}</div>

              <div className="mt-3 flex items-center gap-2 text-[11px] text-neutral-400">
                <span className="rounded-full bg-neutral-50/10 px-2 py-0.5 ring-1 ring-neutral-200/15">
                  {modeKey.toUpperCase()}
                </span>
                <span className="rounded-full bg-neutral-50/10 px-2 py-0.5 ring-1 ring-neutral-200/15">
                  {hops}/{maxHops}
                </span>
              </div>
            </div>
          </div>

          {/* tiny "lights" bar */}
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full w-2/3 animate-pulse bg-neutral-50/20" />
          </div>
        </div>
      </div>

      <style jsx>{`
        .pixel {
          image-rendering: pixelated;
          image-rendering: crisp-edges;
          -ms-interpolation-mode: nearest-neighbor;
        }
        .tone-safe {
          background: radial-gradient(circle at 50% 30%, rgba(56, 189, 248, 0.14), transparent 55%),
            radial-gradient(circle at 30% 80%, rgba(34, 197, 94, 0.10), transparent 55%);
        }
        .tone-wild {
          background: radial-gradient(circle at 50% 30%, rgba(168, 85, 247, 0.16), transparent 55%),
            radial-gradient(circle at 30% 80%, rgba(34, 197, 94, 0.10), transparent 55%);
        }
        .tone-insane {
          background: radial-gradient(circle at 50% 30%, rgba(244, 63, 94, 0.16), transparent 55%),
            radial-gradient(circle at 30% 80%, rgba(250, 204, 21, 0.10), transparent 55%);
        }

        .fx-idle {
          animation: idleBob 1.6s ease-in-out infinite;
        }
        .fx-shake {
          animation: shake 220ms ease-in-out;
        }
        .fx-stamp {
          animation: stamp 320ms cubic-bezier(0.2, 1.2, 0.2, 1);
        }
        .fx-strobe {
          animation: strobe 420ms ease-out;
        }
        .fx-sink {
          animation: sink 700ms ease-in-out forwards;
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
        @keyframes shake {
          0% {
            transform: translate(0, 0) rotate(0deg);
          }
          25% {
            transform: translate(2px, -1px) rotate(-1deg);
          }
          50% {
            transform: translate(-2px, 1px) rotate(1deg);
          }
          75% {
            transform: translate(2px, 1px) rotate(-1deg);
          }
          100% {
            transform: translate(0, 0) rotate(0deg);
          }
        }
        @keyframes stamp {
          0% {
            transform: scale(0.92);
            opacity: 0.6;
          }
          70% {
            transform: scale(1.06);
            opacity: 1;
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes strobe {
          0% {
            box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.2), 0 0 0 rgba(250, 204, 21, 0);
          }
          40% {
            box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.35), 0 0 36px rgba(250, 204, 21, 0.25);
          }
          100% {
            box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.2), 0 0 0 rgba(250, 204, 21, 0);
          }
        }
        @keyframes sink {
          0% {
            transform: translateY(0);
            opacity: 1;
            filter: blur(0px);
          }
          100% {
            transform: translateY(10px);
            opacity: 0.85;
            filter: blur(0.3px);
          }
        }
      `}</style>
    </div>
  );
}
