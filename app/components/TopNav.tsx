"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";

type PlayMode = "demo" | "token";

export type TopNavProps = {
  playMode?: PlayMode;
  setPlayMode?: (m: PlayMode) => void;

  soundOn?: boolean;
  setSoundOn?: React.Dispatch<React.SetStateAction<boolean>>;

  // Lock changing mode, network (handled in page), and disconnect once game is created
  controlsLocked?: boolean;
};

function truncateAddr(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function chainKeyFromChainId(chainId: number | undefined): "linea" | "base" | null {
  if (!chainId) return null;
  if (chainId === 59144) return "linea";
  if (chainId === 8453) return "base";
  return null;
}

const DTC_ICON_SRC = "https://cdn.jsdelivr.net/gh/DonaldToad/dtc-assets@main/dtc-32.svg";

function DtcIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      src={DTC_ICON_SRC}
      alt="DTC"
      width={size}
      height={size}
      className="inline-block"
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
  const chainKey = chainKeyFromChainId(chainId);

  const { connect, connectors, isPending: connectPending } = useConnect();
  const { disconnect } = useDisconnect();

  const showPlayControls = typeof playMode !== "undefined" && typeof setPlayMode === "function";
  const showSoundControl = typeof soundOn !== "undefined" && typeof setSoundOn === "function";

  const lockClass = controlsLocked ? "opacity-60 cursor-not-allowed" : "";

  const demoActive = playMode === "demo";
  const tokenActive = playMode === "token";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-3 py-3 md:px-4 md:py-4">
        {/* Top row: Brand + Controls */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Brand */}
          <div className="flex items-center gap-4">
            <img
              src="/logo/logo.png"
              alt="Lilypad Leap"
              className="h-12 w-12 rounded-xl ring-1 ring-neutral-800 md:h-16 md:w-16"
            />
            <div className="min-w-0">
              <div className="truncate text-lg font-bold leading-tight text-neutral-50 md:text-xl">
                Lilypad Leap
              </div>
              <div className="truncate text-xs text-neutral-400 md:text-sm">Product v1 (frozen)</div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Wallet pill */}
            <div className="flex items-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/30 px-2 py-2">
              {isConnected && chainKey ? (
                <img
                  src={`/chains/${chainKey}.png`}
                  alt={chainKey}
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] rounded-md ring-1 ring-neutral-800"
                  loading="lazy"
                  decoding="async"
                />
              ) : null}

              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-neutral-400 leading-none">Wallet</div>
                <div className="truncate text-xs font-bold text-neutral-100">
                  {isConnected && address ? truncateAddr(address) : "Not connected"}
                </div>
              </div>

              {isConnected ? (
                <button
                  type="button"
                  onClick={() => {
                    if (controlsLocked) return; // 🔒 cannot disconnect after createGame
                    disconnect();
                  }}
                  disabled={!!controlsLocked}
                  title={controlsLocked ? "Locked while a game is active" : "Disconnect"}
                  className={[
                    "rounded-xl border px-3 py-2 text-[11px] font-extrabold transition",
                    controlsLocked
                      ? "border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                  ].join(" ")}
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

            {/* DEMO / TOKEN */}
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
                    "relative rounded-xl px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                    demoActive ? "text-neutral-950" : "text-neutral-200 hover:bg-neutral-800/60",
                    controlsLocked ? lockClass : "",
                    demoActive ? "" : "opacity-80",
                  ].join(" ")}
                  style={
                    demoActive
                      ? {
                          background:
                            "radial-gradient(circle at 50% 10%, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 55%, rgba(0,0,0,0) 100%), linear-gradient(180deg, rgba(250,204,21,0.25), rgba(250,204,21,0.10))",
                          boxShadow:
                            "0 0 0 1px rgba(250,204,21,0.35), 0 0 22px rgba(250,204,21,0.18)",
                        }
                      : undefined
                  }
                  title={controlsLocked ? "Locked while a game is active" : "Demo mode"}
                >
                  🎲 DEMO
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (controlsLocked) return;
                    setPlayMode!("token");
                  }}
                  disabled={!!controlsLocked || !isConnected}
                  title={
                    !isConnected
                      ? "Connect wallet to enable TOKEN mode"
                      : controlsLocked
                      ? "Locked while a game is active"
                      : "Token mode"
                  }
                  className={[
                    "relative rounded-xl px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                    tokenActive ? "text-emerald-100" : "text-neutral-200 hover:bg-neutral-800/60",
                    !isConnected ? "opacity-40 cursor-not-allowed" : "",
                    controlsLocked ? lockClass : "",
                    tokenActive ? "" : "opacity-80",
                  ].join(" ")}
                  style={
                    tokenActive
                      ? {
                          background:
                            "radial-gradient(circle at 50% 10%, rgba(16,185,129,0.28), rgba(16,185,129,0.10) 60%, rgba(0,0,0,0) 100%), linear-gradient(180deg, rgba(16,185,129,0.18), rgba(16,185,129,0.07))",
                          boxShadow: "0 0 0 1px rgba(16,185,129,0.28), 0 0 22px rgba(16,185,129,0.16)",
                        }
                      : undefined
                  }
                >
                  <span className="inline-flex items-center gap-2">
                    TOKEN <DtcIcon size={14} />
                  </span>
                </button>
              </div>
            ) : null}

            {/* Sound */}
            {showSoundControl ? (
              <button
                type="button"
                onClick={() => setSoundOn!((v) => !v)}
                disabled={!!controlsLocked}
                title={controlsLocked ? "Locked while a game is active" : ""}
                className={[
                  "rounded-2xl border px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                  soundOn
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                    : "border-neutral-800 bg-neutral-900/30 text-neutral-200 hover:bg-neutral-800/60",
                  controlsLocked ? lockClass : "",
                ].join(" ")}
                aria-pressed={!!soundOn}
              >
                {soundOn ? "📢 SOUND: ON" : "🔇 SOUND: OFF"}
              </button>
            ) : null}
          </div>
        </div>

        {/* Nav row (mobile: compact, single-line, right-aligned, scroll if needed) */}
        <nav className="mt-2 flex justify-end md:mt-4">
          <div
            className={[
              "flex w-full justify-end gap-2 overflow-x-auto pb-1",
              "md:flex-wrap md:overflow-visible md:pb-0",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            ].join(" ")}
          >
            {NAV.map((item) => {
              const active = pathname === item.href;

              // Optional mobile label shortening (keeps desktop full label)
              const label =
                item.label === "Verify Fairness"
                  ? "Fairness"
                  : item.label;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    "md:px-4 md:py-2 md:text-sm",
                    active
                      ? "border-neutral-700 bg-neutral-800 text-neutral-50"
                      : "border-neutral-800 bg-neutral-900/30 text-neutral-200 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </header>
  );
}
