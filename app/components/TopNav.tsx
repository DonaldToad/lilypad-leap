"use client";

import React, { useEffect, useState } from "react";
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
  { href: "/", label: "Home" },
  { href: "/profile", label: "Profile" },
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/verify", label: "Verify Fairness" },
  { href: "/swap", label: "Swap & Bridge" },
  { href: "/earn", label: "Earn" },
];

export default function TopNav(props: TopNavProps) {
  const pathname = usePathname();
  const { playMode, setPlayMode, soundOn, setSoundOn, controlsLocked } = props;

  const [mounted, setMounted] = useState(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const chainKey = chainKeyFromChainId(chainId);

  const { connect, connectors, isPending: connectPending } = useConnect();
  const { disconnect } = useDisconnect();

  const showPlayControls = typeof playMode !== "undefined" && typeof setPlayMode === "function";
  const showSoundControl = typeof soundOn !== "undefined" && typeof setSoundOn === "function";

  const demoActive = playMode === "demo";
  const tokenActive = playMode === "token";

  // ✅ When game is active, lock EVERYTHING in the top nav
  const locked = !!controlsLocked;

  // -----------------------------
  // Mobile: collapse TopNav on scroll (do NOT disappear)
  // - At top: full nav
  // - Scrolled down: compact bar (logo + title + wallet only)
  // -----------------------------
  const [isMobile, setIsMobile] = useState(false);
  const [mobileCollapsed, setMobileCollapsed] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const computeIsMobile = () => setIsMobile(window.innerWidth < 900);
    computeIsMobile();
    window.addEventListener("resize", computeIsMobile, { passive: true });
    return () => window.removeEventListener("resize", computeIsMobile);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // If not mobile, always show full header.
    if (!isMobile) {
      setMobileCollapsed(false);
      return;
    }

    const onScroll = () => {
      const y = window.scrollY || window.pageYOffset || 0;
      // Collapse once you leave the top area
      setMobileCollapsed(y > 20);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, [isMobile]);

  const WalletPill = ({ compact }: { compact?: boolean }) => (
    <div
      className={[
        "flex items-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/30",
        compact ? "px-2 py-1.5" : "px-2 py-2",
      ].join(" ")}
    >
      {mounted && isConnected && chainKey ? (
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
          {mounted && isConnected && address ? truncateAddr(address) : "Not connected"}
        </div>
      </div>

      {mounted && isConnected ? (
        <button
          type="button"
          onClick={() => {
            if (locked) return;
            disconnect();
          }}
          disabled={locked}
          title={locked ? "Locked while a game is active" : "Disconnect"}
          className={[
            "rounded-xl border px-3 py-2 text-[11px] font-extrabold transition",
            compact ? "py-1.5" : "py-2",
            locked
              ? "border-neutral-800 bg-neutral-900 text-neutral-500 cursor-not-allowed"
              : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
          ].join(" ")}
        >
          DISCONNECT
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (locked) return;
            connect({ connector: connectors[0] });
          }}
          disabled={connectPending || locked}
          title={locked ? "Locked while a game is active" : "Connect"}
          className={[
            "rounded-xl border px-3 text-[11px] font-extrabold tracking-wide transition",
            compact ? "py-1.5" : "py-2",
            connectPending || locked
              ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
          ].join(" ")}
        >
          {connectPending ? "CONNECTING…" : "CONNECT"}
        </button>
      )}
    </div>
  );

  return (
    <header
      className={[
        "sticky top-0 z-40 w-full backdrop-blur",
        "border-b border-neutral-800 bg-neutral-950/80",
        "transition-[background-color,border-color] duration-300",
      ].join(" ")}
    >
      <div
        className={[
          "mx-auto w-full max-w-6xl px-3 md:px-4",
          mobileCollapsed ? "py-2" : "py-3",
          "md:py-4",
          "transition-[padding] duration-300 ease-out",
        ].join(" ")}
      >
        {/* --------------------------------
            MOBILE (collapsed): compact bar only
           -------------------------------- */}
        {isMobile && mobileCollapsed ? (
          <div className="flex items-center justify-between gap-3">
            {/* Brand (compact) */}
            <div className="flex min-w-0 items-center gap-2">
              <img
                src="/logo/logo.png"
                alt="Lilypad Leap"
                className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-neutral-800"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold leading-tight text-neutral-50">Lilypad Leap</div>
                <div className="truncate text-[10px] text-neutral-400">v1</div>
              </div>
            </div>

            {/* Wallet only */}
            <div className="shrink-0">
              <WalletPill compact />
            </div>
          </div>
        ) : (
          /* --------------------------------
             FULL HEADER (desktop + mobile at top)
             -------------------------------- */
          <div className="transition-opacity duration-300">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {/* Brand */}
              <div className="flex items-center gap-4">
                <img
                  src="/logo/logo.png"
                  alt="Lilypad Leap"
                  className="h-12 w-12 rounded-xl ring-1 ring-neutral-800 md:h-16 md:w-16"
                />
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold leading-tight text-neutral-50 md:text-xl">Lilypad Leap</div>
                  <div className="truncate text-xs text-neutral-400 md:text-sm">The original multichain DTC game by Donald Toad</div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <WalletPill />

                {/* DEMO / TOKEN */}
                {showPlayControls ? (
                  <div className="flex items-center rounded-2xl border border-neutral-800 bg-neutral-900/30 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (locked) return;
                        setPlayMode!("demo");
                      }}
                      disabled={locked}
                      title={locked ? "Locked while a game is active" : "Demo mode"}
                      className={[
                        "relative rounded-xl px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                        demoActive ? "text-neutral-950" : "text-neutral-200 hover:bg-neutral-800/60",
                        locked ? "opacity-60 cursor-not-allowed" : "",
                        demoActive ? "" : "opacity-80",
                      ].join(" ")}
                      style={
                        demoActive
                          ? {
                              background:
                                "radial-gradient(circle at 50% 10%, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 55%, rgba(0,0,0,0) 100%), linear-gradient(180deg, rgba(250,204,21,0.25), rgba(250,204,21,0.10))",
                              boxShadow: "0 0 0 1px rgba(250,204,21,0.35), 0 0 22px rgba(250,204,21,0.18)",
                            }
                          : undefined
                      }
                    >
                      🎲 DEMO
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (locked) return;
                        setPlayMode!("token");
                      }}
                      disabled={locked || !mounted || !isConnected}
                      title={
                        locked
                          ? "Locked while a game is active"
                          : !mounted || !isConnected
                          ? "Connect wallet to enable TOKEN mode"
                          : "Token mode"
                      }
                      className={[
                        "relative rounded-xl px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                        tokenActive ? "text-emerald-100" : "text-neutral-200 hover:bg-neutral-800/60",
                        !mounted || !isConnected ? "opacity-40 cursor-not-allowed" : "",
                        locked ? "opacity-60 cursor-not-allowed" : "",
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
                    onClick={() => {
                      if (locked) return;
                      setSoundOn!((v) => !v);
                    }}
                    disabled={locked}
                    title={locked ? "Locked while a game is active" : "Toggle sound"}
                    className={[
                      "rounded-2xl border px-3 py-2 text-[11px] font-extrabold tracking-wide transition",
                      locked
                        ? "cursor-not-allowed border-neutral-800 bg-neutral-900/30 text-neutral-500 opacity-70"
                        : soundOn
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                        : "border-neutral-800 bg-neutral-900/30 text-neutral-200 hover:bg-neutral-800/60",
                    ].join(" ")}
                    aria-pressed={!!soundOn}
                  >
                    {soundOn ? "📢 SOUND: ON" : "🔇 SOUND: OFF"}
                  </button>
                ) : null}
              </div>
            </div>

            {/* Nav row (FIXED: WRAPS on mobile, stays clean & accessible) */}
            <nav className="mt-2 flex md:mt-4">
              <div
                className={[
                  "flex w-full flex-wrap gap-2",
                  "justify-start md:justify-end",
                ].join(" ")}
              >
                {NAV.map((item) => {
                  const active = pathname === item.href;
                  const label = item.label === "Verify Fairness" ? "Fairness" : item.label;

                  const baseClasses = [
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    "md:px-4 md:py-2 md:text-sm",
                    active
                      ? "border-neutral-700 bg-neutral-800 text-neutral-50"
                      : "border-neutral-800 bg-neutral-900/30 text-neutral-200 hover:bg-neutral-800/60",
                  ].join(" ");

                  if (locked) {
                    return (
                      <span
                        key={item.href}
                        title="Locked while a game is active"
                        className={[baseClasses, "cursor-not-allowed opacity-60"].join(" ")}
                      >
                        {label}
                      </span>
                    );
                  }

                  return (
                    <Link key={item.href} href={item.href} className={baseClasses}>
                      {label}
                    </Link>
                  );
                })}
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
