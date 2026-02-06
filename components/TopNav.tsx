// app/components/TopNav.tsx
"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CHAIN_LIST } from "../lib/chains";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";

type PlayMode = "demo" | "token";

export type TopNavProps = {
  /** Optional: show Play-mode controls (DEMO/TOKEN) in the header */
  playMode?: PlayMode;
  setPlayMode?: (m: PlayMode) => void;

  /** Optional: show sound toggle in the header */
  soundOn?: boolean;
  setSoundOn?: React.Dispatch<React.SetStateAction<boolean>>;

  /** Optional: lock buttons (e.g., while a game is active / tx pending) */
  controlsLocked?: boolean;
};

function truncateAddr(addr: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ChainPillIcon({ chainKey }: { chainKey: string }) {
  const src = `/chains/${chainKey}.png`; // expects /public/chains/linea.png and /public/chains/base.png
  return (
    <img
      src={src}
      alt={chainKey}
      width={18}
      height={18}
      className="h-[18px] w-[18px] rounded-md ring-1 ring-neutral-800"
      loading="lazy"
      decoding="async"
    />
  );
}

const NAV = [
  { href: "/profile", label: "Profile" },
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/verify", label: "Verify Fairness" },
  { href: "/swap", label: "Swap" },
];

export default function TopNav(props: TopNavProps) {
  const pathname = usePathname();

  const { playMode, setPlayMode, soundOn, setSoundOn, controlsLocked } = props;

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: connectPending } = useConnect();
  const { disconnect } = useDisconnect();

  const chainMeta = React.useMemo(() => {
    return CHAIN_LIST.find((c) => c.chainId === chainId);
  }, [chainId]);

  const showPlayControls = typeof playMode !== "undefined" && typeof setPlayMode === "function";
  const showSoundControl = typeof soundOn !== "undefined" && typeof setSoundOn === "function";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-3 py-3 md:px-4 md:py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Left: logo + title (compacted on mobile) */}
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <img
                src="/logo/logo.png"
                alt="Lilypad Leap logo"
                className="h-12 w-12 rounded-xl ring-1 ring-neutral-800 md:h-16 md:w-16"
                loading="eager"
              />
            </div>

            <div className="min-w-0">
              <div className="truncate text-lg font-bold leading-tight text-neutral-50 md:text-xl">
                Lilypad Leap
              </div>
              <div className="truncate text-xs text-neutral-400 md:text-sm">Product v1 (frozen)</div>
            </div>
          </div>

          {/* Right: controls row (wraps neatly on mobile) */}
          <div className="flex flex-wrap items-center justify-end gap-2 md:flex-nowrap">
            {/* Wallet pill */}
            <div className="flex items-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/30 px-2 py-2">
              {isConnected && chainMeta?.key ? <ChainPillIcon chainKey={chainMeta.key} /> : null}

              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-neutral-400 leading-none">Wallet</div>
                <div className="truncate text-xs font-bold text-neutral-100">
                  {isConnected && address ? truncateAddr(address) : "Not connected"}
                </div>
              </div>

              {isConnected ? (
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] font-extrabold text-neutral-200 hover:bg-neutral-800/60"
                >
                  DISCONNECT
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => connect({ connector: connectors[0] })}
                  disabled={connectPending}
                  className={[
                    "rounded-xl border px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                    connectPending
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                  ].join(" ")}
                >
                  {connectPending ? "CONNECTING…" : "CONNECT"}
                </button>
              )}
            </div>

            {/* DEMO / TOKEN toggle */}
            {showPlayControls ? (
              <div className="flex items-center rounded-2xl border border-neutral-800 bg-neutral-900/30 p-1">
                <button
                  type="button"
                  onClick={() => {
                    if (controlsLocked) return;
                    setPlayMode!("demo");
                  }}
                  disabled={!!controlsLocked}
                  className={[
                    "rounded-xl px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                    playMode === "demo"
                      ? "bg-neutral-950 text-neutral-50 ring-1 ring-neutral-800"
                      : "text-neutral-200 hover:bg-neutral-800/60",
                    controlsLocked ? "opacity-60 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  DEMO
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (controlsLocked) return;
                    setPlayMode!("token");
                  }}
                  disabled={!!controlsLocked || !isConnected}
                  title={!isConnected ? "Connect wallet to enable TOKEN mode" : ""}
                  className={[
                    "rounded-xl px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                    playMode === "token"
                      ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20"
                      : "text-neutral-200 hover:bg-neutral-800/60",
                    !isConnected ? "opacity-40 cursor-not-allowed" : "",
                    controlsLocked ? "opacity-60 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  TOKEN
                </button>
              </div>
            ) : null}

            {/* Sound toggle */}
            {showSoundControl ? (
              <button
                type="button"
                onClick={() => setSoundOn!((v) => !v)}
                disabled={!!controlsLocked}
                className={[
                  "rounded-2xl border px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                  soundOn
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                    : "border-neutral-800 bg-neutral-900/30 text-neutral-200 hover:bg-neutral-800/60",
                  controlsLocked ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
                aria-pressed={!!soundOn}
                aria-label={soundOn ? "Mute sound" : "Enable sound"}
              >
                {soundOn ? "📢 SOUND: ON" : "🔇 SOUND: OFF"}
              </button>
            ) : null}
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap gap-2">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  active
                    ? "border-neutral-700 bg-neutral-800 text-neutral-50"
                    : "border-neutral-800 bg-neutral-900/30 text-neutral-200 hover:bg-neutral-800/60",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
