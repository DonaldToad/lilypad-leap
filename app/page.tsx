// app/page.tsx
"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import TopNav from "./components/TopNav";
import { CHAIN_LIST, PRIMARY_CHAIN } from "./lib/chains";
import { useAccount, useChainId, useSwitchChain } from "wagmi";

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
      decoding="async"
    />
  );
}

// Token-mode chains you support (Linea + Base)
const TOKEN_CHAIN_IDS = [59144, 8453] as const;
type TokenChainId = (typeof TOKEN_CHAIN_IDS)[number];

function isTokenChain(id: number | undefined): id is TokenChainId {
  return !!id && (TOKEN_CHAIN_IDS as readonly number[]).includes(id);
}

const DTC_ICON_SRC = "https://cdn.jsdelivr.net/gh/DonaldToad/dtc-assets@main/dtc-32.svg";
// Put your file at: public/brands/layerzero/LayerZero_logowhite.svg
const LZ_ICON_SRC = "/brands/layerzero/LayerZero_logowhite.svg";

function EcosystemList() {
  const itemClass =
    "flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 px-4 py-3 transition hover:bg-neutral-900/50";
  const titleClass = "text-sm font-semibold text-neutral-100";
  const subClass = "text-xs text-neutral-400";

  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-neutral-100">Powered by / Ecosystem</div>

      <div className="space-y-3">
        <a href="https://donaldtoad.com" target="_blank" rel="noreferrer" className={itemClass}>
          <img
            src={DTC_ICON_SRC}
            alt="Donald Toad Coin"
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg ring-1 ring-neutral-800"
            loading="lazy"
            decoding="async"
          />
          <div className="leading-tight">
            <div className={titleClass}>Donald Toad Coin</div>
            <div className={subClass}>donaldtoad.com</div>
          </div>
        </a>

        <a href="https://linea.build" target="_blank" rel="noreferrer" className={itemClass}>
          <ChainIcon chainKey="linea" alt="Linea" />
          <div className="leading-tight">
            <div className={titleClass}>Linea</div>
            <div className={subClass}>linea.build</div>
          </div>
        </a>

        <a href="https://base.org" target="_blank" rel="noreferrer" className={itemClass}>
          <ChainIcon chainKey="base" alt="Base" />
          <div className="leading-tight">
            <div className={titleClass}>Base</div>
            <div className={subClass}>base.org</div>
          </div>
        </a>

        <a href="https://layerzero.network" target="_blank" rel="noreferrer" className={itemClass}>
          <div className="grid h-7 w-7 place-items-center overflow-hidden rounded-lg bg-neutral-950 ring-1 ring-neutral-800">
            <img
              src={LZ_ICON_SRC}
              alt="LayerZero"
              width={28}
              height={28}
              className="h-7 w-7"
              loading="lazy"
              decoding="async"
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                img.style.display = "none";
                const parent = img.parentElement;
                if (parent && !parent.querySelector("[data-fallback='lz']")) {
                  const span = document.createElement("span");
                  span.setAttribute("data-fallback", "lz");
                  span.className = "text-[11px] font-extrabold text-neutral-200";
                  span.textContent = "LZ";
                  parent.appendChild(span);
                }
              }}
            />
          </div>

          <div className="leading-tight">
            <div className={titleClass}>LayerZero</div>
            <div className={subClass}>layerzero.network</div>
          </div>
        </a>
      </div>

      <div className="mt-4 text-[11px] text-neutral-500">
        Tip: bridge direction can be automatic. Switch your network to change direction (where applicable).
      </div>
    </div>
  );
}

export default function HomePage() {
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted;

  // Only show Linea + Base (stable order: Linea then Base)
  const chains = useMemo(() => {
    const filtered = CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any));
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort((a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99));
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(PRIMARY_CHAIN.chainId);

  // Mirror wallet network when wallet is on a supported chain
  useEffect(() => {
    if (!ready) return;
    if (isTokenChain(walletChainId)) setSelectedChainId(walletChainId);
  }, [ready, walletChainId]);

  const selectedChain = useMemo(() => {
    return chains.find((c) => c.chainId === selectedChainId) ?? PRIMARY_CHAIN;
  }, [chains, selectedChainId]);

  const [switchStatus, setSwitchStatus] = useState<string>("");

  async function onPickChain(chainId: number) {
    setSwitchStatus("");
    setSelectedChainId(chainId);

    // Switch the wallet chain (same behavior as /play)
    if (!ready) return;
    if (!isConnected) {
      setSwitchStatus("Connect your wallet to switch network.");
      return;
    }

    try {
      await switchChainAsync?.({ chainId });
      setSwitchStatus("");
    } catch (e: any) {
      setSwitchStatus(e?.shortMessage || e?.message || "Network switch failed.");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          {/* Hero */}
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-col gap-4 md:flex-row md:items-center">
                <img
                  src="/logo/logo.png"
                  alt="Lilypad Leap logo"
                  className="h-24 w-24 rounded-2xl ring-1 ring-neutral-800 md:h-28 md:w-28"
                  loading="eager"
                  decoding="async"
                />

                <div className="min-w-0">
                  <h1 className="text-3xl font-extrabold tracking-tight">Lilypad Leap</h1>
                  <p className="mt-2 max-w-2xl text-sm text-neutral-300">
                    A strategy-probability game built for the Donald Toad Coin (DTC) ecosystem. Choose your chain, hop
                    for higher multipliers, or cash out before you bust—then verify fairness using your secret.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-200 ring-1 ring-emerald-500/20">
                      Commit-reveal fairness
                    </span>
                    <span className="rounded-full bg-neutral-50/10 px-3 py-1 font-semibold text-neutral-200 ring-1 ring-neutral-200/20">
                      Multi-chain support
                    </span>
                    <span className="rounded-full bg-neutral-50/10 px-3 py-1 font-semibold text-neutral-200 ring-1 ring-neutral-200/20">
                      Leaderboards
                    </span>
                    <span className="rounded-full bg-neutral-50/10 px-3 py-1 font-semibold text-neutral-200 ring-1 ring-neutral-200/20">
                      Referrals
                    </span>
                    <span className="rounded-full bg-neutral-50/10 px-3 py-1 font-semibold text-neutral-200 ring-1 ring-neutral-200/20">
                      Fairness page
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Link
                href="/play"
                className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-extrabold text-neutral-950 hover:bg-emerald-400"
              >
                Play
              </Link>
              <Link
                href="/leaderboard"
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-3 text-sm font-semibold text-neutral-100 hover:bg-neutral-800/60"
              >
                Leaderboard
              </Link>
              <Link
                href="/verify"
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-3 text-sm font-semibold text-neutral-100 hover:bg-neutral-800/60"
              >
                Fairness
              </Link>
            </div>
          </div>

          {/* Feature cards */}
          <div className="mt-7 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm font-semibold text-neutral-100">Play</div>
              <div className="mt-2 text-sm text-neutral-300">Place a stake, then hop or cash out.</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm font-semibold text-neutral-100">Fairness verification</div>
              <div className="mt-2 text-sm text-neutral-300">
                Recompute rolls and payout from your <span className="font-mono">userSecret</span> + on-chain{" "}
                <span className="font-mono">randAnchor</span>. Export/import bundles for cross-device verification.
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm font-semibold text-neutral-100">Leaderboard + referrals</div>
              <div className="mt-2 text-sm text-neutral-300">
                Track top players, volume, and performance. Share referral links where available.
              </div>
            </div>
          </div>

          {/* Combined card: on ALL screen sizes, Ecosystem is BELOW Network (prevents tall empty block on desktop) */}
          <div className="mt-7 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            {/* Network */}
            <div>
              <div className="flex flex-col gap-4">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Network</div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Selected: <span className="font-semibold text-neutral-200">{selectedChain?.name ?? "—"}</span>
                  </div>
                </div>

                <div className="w-full">
                  {/* one-row toggle always */}
                  <div className="flex w-full gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-2">
                    {chains.map((c) => {
                      const active = c.chainId === selectedChainId;
                      const showLive = active; // only selected shows LIVE

                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => void onPickChain(c.chainId)}
                          className={[
                            "min-w-0 flex-1 rounded-xl px-3 py-3 text-left transition",
                            active
                              ? "border border-emerald-500/30 bg-emerald-500/10 ring-1 ring-emerald-500/10"
                              : "border border-transparent hover:bg-neutral-900/50",
                          ].join(" ")}
                        >
                          <div className="flex items-center gap-3">
                            <ChainIcon chainKey={c.key} alt={`${c.name} icon`} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-neutral-50">{c.name}</div>
                                {showLive ? (
                                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
                                    LIVE
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 text-[11px] text-neutral-400">Chain ID: {c.chainId}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {switchStatus ? <div className="mt-2 text-[11px] text-amber-200">{switchStatus}</div> : null}

                  {!ready ? (
                    <div className="mt-2 text-[11px] text-neutral-600">Initializing…</div>
                  ) : isConnected ? (
                    <div className="mt-2 text-[11px] text-neutral-600">
                      Wallet network:{" "}
                      <span className="text-neutral-300">
                        {isTokenChain(walletChainId)
                          ? chains.find((c) => c.chainId === walletChainId)?.name ?? walletChainId
                          : walletChainId ?? "—"}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-neutral-600">
                      Not connected. The toggle will switch your wallet network after you connect.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="my-4 border-t border-neutral-800" />

            {/* Ecosystem */}
            <EcosystemList />
          </div>

          {/* Disclaimers */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Important disclaimers</div>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[12px] leading-relaxed text-neutral-300">
              <li>
                <b>18+ only.</b> By using this site, you confirm you are at least 18 years old (or the age of majority in
                your jurisdiction, whichever is higher).
              </li>
              <li>
                <b>Jurisdiction responsibility.</b> You are solely responsible for ensuring that accessing and using
                strategy-probability games like Lilypad Leap is lawful in your jurisdiction and at your access location.
              </li>
              <li>
                <b>Entertainment only.</b> Donald Toad Coin (DTC) and its associated games are provided strictly for
                entertainment purposes.
              </li>
              <li>
                <b>No expectation of profit.</b> DTC has no intrinsic value. No guarantees are made regarding price,
                liquidity, availability, or potential gains. Do not participate with an expectation of profit.
              </li>
              <li>
                <b>No formal team / no promises.</b> This is a community-driven experiment. Features may change, be
                delayed, or be discontinued at any time.
              </li>
              <li>
                <b>Risk warning.</b> You can lose your stake. Only play with funds you can afford to lose.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
