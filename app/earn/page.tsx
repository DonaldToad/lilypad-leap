// app/earn/page.tsx
"use client";

import TopNav from "../components/TopNav";
import React, { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { zeroAddress, type Hex, isHex } from "viem";

import { CHAIN_LIST } from "../lib/chains";
import { REFERRAL_REGISTRY_ABI } from "../lib/abi/referralRegistry";
import { REF_REGISTRY_BY_CHAIN } from "../lib/addresses";

const SITE_ORIGIN = "https://hop.donaldtoad.com";

// Match Home behavior: token-mode chains only (Linea + Base)
const TOKEN_CHAIN_IDS = [59144, 8453] as const;
type TokenChainId = (typeof TOKEN_CHAIN_IDS)[number];

function isTokenChain(id: number | undefined): id is TokenChainId {
  return !!id && (TOKEN_CHAIN_IDS as readonly number[]).includes(id);
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
      decoding="async"
    />
  );
}

function truncateAddr(a?: string) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * NOTE (important, based on your current ABI):
 * - You currently have:
 *   - referrer_total_generated_loss
 *   - referrer_total_rewards
 * - You DO NOT currently have in your ABI:
 *   - referrer_total_generated_won  (for “Frens won”)
 *   - pending rewards read
 *   - claim rewards write
 *
 * This page wires everything that exists in your provided ABI, and includes a “💰Rewards” box.
 * The claim button is intentionally disabled until you add the pending/claim functions to your ABI + contract.
 */

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted;

  // Only show Linea + Base, stable order: Linea then Base (same as Home)
  const chains = useMemo(() => {
    const filtered = CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any));
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort((a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99));
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(59144);

  // Mirror wallet network when wallet is on a supported chain (same as Home)
  useEffect(() => {
    if (!ready) return;
    if (isTokenChain(walletChainId)) setSelectedChainId(walletChainId);
  }, [ready, walletChainId]);

  const selectedChain = useMemo(() => {
    return chains.find((c) => c.chainId === selectedChainId) ?? chains[0];
  }, [chains, selectedChainId]);

  const effectiveChainId = ready ? selectedChainId : undefined;

  const registryAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (REF_REGISTRY_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const chainName = useMemo(() => {
    if (!effectiveChainId) return "—";
    return CHAIN_LIST.find((c) => c.chainId === effectiveChainId)?.name ?? String(effectiveChainId);
  }, [effectiveChainId]);

  const walletNetworkName = useMemo(() => {
    if (!ready || !walletChainId) return "—";
    return CHAIN_LIST.find((c) => c.chainId === walletChainId)?.name ?? String(walletChainId);
  }, [ready, walletChainId]);

  const wrongWalletForSelected = useMemo(() => {
    if (!ready || !isConnected) return false;
    if (!effectiveChainId || !walletChainId) return false;
    return walletChainId !== effectiveChainId;
  }, [ready, isConnected, walletChainId, effectiveChainId]);

  const readsEnabled =
    ready && !!effectiveChainId && isConnected && !!address && registryAddress !== zeroAddress;

  // Reads (ONLY what exists in your provided ABI)
  const { data: referrerOfMe, refetch: refetchReferrer } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrerOf",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  const { data: myPublicCode, refetch: refetchMyCode } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "publicCodeOf",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  const { data: frensLossRaw, refetch: refetchLoss } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_generated_loss",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  const { data: myRewardsTotalRaw, refetch: refetchRewards } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  // UI state
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [rewardCopied, setRewardCopied] = useState(false);
  const [switchStatus, setSwitchStatus] = useState<string>("");

  const myCodeHex = (myPublicCode as Hex | undefined) ?? null;
  const haveCode = !!myCodeHex && isHex(myCodeHex) && myCodeHex.length === 66;

  const referralLink = useMemo(() => {
    if (!haveCode) return "";
    return `${SITE_ORIGIN}/play?ref=${myCodeHex}`;
  }, [haveCode, myCodeHex]);

  const isBound = (referrerOfMe as string | undefined) && (referrerOfMe as string) !== zeroAddress;

  async function onPickChain(nextId: number) {
    setSwitchStatus("");
    setErr("");
    setStatus("");

    setSelectedChainId(nextId);

    // Same UX as Home: try to switch wallet chain if connected
    if (!ready) return;
    if (!isConnected) {
      setSwitchStatus("Connect your wallet to switch network.");
      return;
    }

    try {
      await switchChainAsync?.({ chainId: nextId });
      setSwitchStatus("");
    } catch (e: any) {
      setSwitchStatus(e?.shortMessage || e?.message || "Network switch failed.");
    }
  }

  async function registerCode() {
    setErr("");
    setStatus("");

    if (!ready || !isConnected || !address) {
      setErr("Connect your wallet first.");
      return;
    }
    if (!effectiveChainId || registryAddress === zeroAddress) {
      setErr("Unsupported chain for referrals.");
      return;
    }
    if (!publicClient) {
      setErr("No public client.");
      return;
    }
    if (wrongWalletForSelected) {
      setErr(`Switch wallet network to ${chainName} to register on this chain.`);
      return;
    }

    try {
      setStatus("Confirm in wallet…");

      const hash = await writeContractAsync({
        chainId: effectiveChainId,
        abi: REFERRAL_REGISTRY_ABI,
        address: registryAddress,
        functionName: "registerMyPublicCode",
        args: [],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Public code registered ✅");
      window.setTimeout(() => setStatus(""), 1200);

      await Promise.allSettled([refetchMyCode(), refetchLoss(), refetchRewards(), refetchReferrer()]);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Register failed.");
    }
  }

  // Rewards (placeholder until ABI + contract adds pending+claim)
  const pendingRewardsLabel = "—";
  const claimDisabledReason =
    "Claim requires pending/claim functions in the referral registry (not in your current ABI).";

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Earn</h1>
              <p className="mt-2 text-neutral-300">
                Referrals are permanent (wallet-bound). View stats per network and claim rewards once claim endpoints
                are enabled.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Viewing: <span className="text-neutral-100">{chainName}</span>
              {ready && isConnected ? (
                <span className="ml-2 text-neutral-500">
                  (wallet: <span className="text-neutral-300">{walletNetworkName}</span>)
                </span>
              ) : null}
            </div>
          </div>

          {/* Home-like multichain toggle (NO "primary" label; same card style) */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Network</div>
                <div className="mt-1 text-xs text-neutral-500">
                  Selected: <span className="font-semibold text-neutral-200">{selectedChain?.name ?? "—"}</span>
                </div>
              </div>

              <div className="w-full">
                <div className="flex w-full gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-2">
                  {chains.map((c) => {
                    const active = c.chainId === selectedChainId;
                    const showLive = active;

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

          {/* Wallet card */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 text-sm text-neutral-300">
              {ready && isConnected && address ? `Connected: ${truncateAddr(address)}` : "Not connected"}
            </div>

            {ready && registryAddress !== zeroAddress ? (
              <div className="mt-2 text-[12px] text-neutral-500">
                Registry: <span className="font-mono text-neutral-300">{registryAddress}</span>
              </div>
            ) : (
              <div className="mt-2 text-[12px] text-neutral-500">Registry: — (unsupported chain)</div>
            )}
          </div>

          {/* 💰Rewards */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Pending rewards require a pending/claim endpoint in the referral registry (not in your current ABI).
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const txt = `Chain: ${chainName}\nPending: ${pendingRewardsLabel}\nWallet: ${address ?? "—"}`;
                    const ok = await copyText(txt);
                    if (ok) {
                      setRewardCopied(true);
                      window.setTimeout(() => setRewardCopied(false), 900);
                    }
                  }}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                >
                  {rewardCopied ? "COPIED" : "COPY"}
                </button>

                <button
                  type="button"
                  disabled
                  title={claimDisabledReason}
                  className="cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-500"
                >
                  CLAIM
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Pending</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{pendingRewardsLabel}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Lifetime rewards</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(myRewardsTotalRaw as any)?.toString?.() ?? "0"}
                </div>
              </div>
            </div>
          </div>

          {/* Referrer binding */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Your referrer</div>
            <div className="mt-2 text-sm text-neutral-300">
              {ready && isConnected && address ? (
                isBound ? (
                  <span>
                    Bound to: <span className="font-mono">{truncateAddr(referrerOfMe as string)}</span>
                  </span>
                ) : (
                  <span className="text-neutral-400">
                    Not bound yet. You’ll auto-bind on your first bet if you visit a referral link.
                  </span>
                )
              ) : (
                <span className="text-neutral-400">Connect your wallet to view.</span>
              )}
            </div>
          </div>

          {/* My referral link */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Your referral link</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Share this link. Users will bind automatically on their first bet.
                </div>
              </div>

              <button
                type="button"
                onClick={() => void registerCode()}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                disabled={!ready || !isConnected || registryAddress === zeroAddress || wrongWalletForSelected}
                title={wrongWalletForSelected ? `Switch wallet to ${chainName}` : undefined}
              >
                {haveCode ? "RE-REGISTER (optional)" : "REGISTER MY CODE"}
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="text-[12px] text-neutral-400">Code (bytes32)</div>
              <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                {haveCode ? myCodeHex : "— (register first)"}
              </div>

              <div className="mt-3 text-[12px] text-neutral-400">Link</div>
              <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">{haveCode ? referralLink : "—"}</div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (!referralLink) return;
                    const ok = await copyText(referralLink);
                    if (ok) {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 900);
                    }
                  }}
                  disabled={!referralLink}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    referralLink
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                      : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                  ].join(" ")}
                >
                  {copied ? "COPIED" : "COPY LINK"}
                </button>
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Lifetime totals</div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Frens loss</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{(frensLossRaw as any)?.toString?.() ?? "0"}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Frens won</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">—</div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  Add <span className="font-mono text-neutral-300">referrer_total_generated_won</span> to ABI + contract to show this.
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Total rewards</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(myRewardsTotalRaw as any)?.toString?.() ?? "0"}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              These update when your weekly distribution is posted and users claim.
            </div>
          </div>

          {status ? (
            <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-200">
              {status}
            </div>
          ) : null}

          {err ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
              {err}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
