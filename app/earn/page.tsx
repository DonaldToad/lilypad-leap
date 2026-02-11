// app/earn/page.tsx
"use client";

import TopNav from "../components/TopNav";
import React, { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { zeroAddress, type Hex, isHex, formatUnits } from "viem";

import { CHAIN_LIST } from "../lib/chains";
import { REFERRAL_REGISTRY_ABI } from "../lib/abi/referralRegistry";
import {
  REF_REGISTRY_BY_CHAIN,
  WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN,
  DTC_BY_CHAIN,
} from "../lib/addresses";

const SITE_ORIGIN = "https://hop.donaldtoad.com";

/**
 * Token-mode chains you support (Linea + Base)
 */
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

function fmtNum(n: number, maxFrac = 6) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

/**
 * ==========================
 * WeeklyRewardsDistributor ABI (minimal)
 * ==========================
 * You provided full ABI; we only need these:
 * - currentEpoch()
 * - claim(epochId, amount, generatedLoss, proof)
 * - claimed(epochId, user)
 */
const WEEKLY_REWARDS_DISTRIBUTOR_ABI = [
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "epochId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "generatedLoss", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
] as const;

/**
 * ==========================
 * Option C: GitHub Raw bundle source
 * ==========================
 * We’ll fetch:
 *   https://raw.githubusercontent.com/<OWNER>/<REPO>/<BRANCH>/<PATH>
 *
 * You ONLY need to set this base path to wherever you publish weekly outputs.
 *
 * Recommended convention:
 *   /public/claims/<chainId>/<userLower>.json
 *
 * Example:
 *   claims/59144/0xabc...def.json
 */
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/DonaldToad/lilypad-leap/main/claims";

/**
 * Claim bundle format returned by GitHub raw JSON.
 * This must match what your weekly script exports.
 */
type ClaimBundle = {
  chainId: number;
  user: `0x${string}`;
  epochId: string; // uint as string
  amount: string; // uint as string (token units, same as contract expects)
  generatedLoss: string; // uint as string
  proof: `0x${string}`[]; // bytes32[]
  distributor?: `0x${string}`; // optional sanity check
  token?: `0x${string}`; // optional
};

function getChainName(chainId: number | undefined) {
  if (!chainId) return "—";
  return CHAIN_LIST.find((c) => c.chainId === chainId)?.name ?? String(chainId);
}

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * ===========
   * Chain toggle (same UX as Home)
   * ===========
   */
  const chains = useMemo(() => {
    const filtered = CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any));
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort((a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99));
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(59144);

  // Mirror wallet network when wallet is on a supported chain
  useEffect(() => {
    if (!mounted) return;
    if (isTokenChain(walletChainId)) setSelectedChainId(walletChainId);
  }, [mounted, walletChainId]);

  const effectiveChainId = mounted ? selectedChainId : undefined;
  const selectedChain = useMemo(() => {
    return chains.find((c) => c.chainId === selectedChainId) ?? chains[0];
  }, [chains, selectedChainId]);

  const [switchStatus, setSwitchStatus] = useState("");

  async function onPickChain(chainId: number) {
    setSwitchStatus("");
    setSelectedChainId(chainId);

    if (!mounted) return;
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

  const wrongWalletForSelected = useMemo(() => {
    if (!mounted || !isConnected) return false;
    if (!effectiveChainId || !walletChainId) return false;
    return walletChainId !== effectiveChainId;
  }, [mounted, isConnected, walletChainId, effectiveChainId]);

  /**
   * ===========
   * Addresses per chain
   * ===========
   */
  const registryAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (REF_REGISTRY_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const distributorAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const tokenAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (DTC_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const chainName = useMemo(() => getChainName(effectiveChainId), [effectiveChainId]);
  const walletNetworkName = useMemo(() => getChainName(walletChainId), [walletChainId]);

  /**
   * ===========
   * Reads (ReferralRegistry)
   * ===========
   * Note: your ABI only includes:
   * - referrerOf
   * - publicCodeOf
   * - referrer_total_generated_loss
   * - referrer_total_rewards
   */
  const readsEnabled =
    mounted && !!effectiveChainId && isConnected && !!address && registryAddress !== zeroAddress;

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

  const { data: totalRewardsRaw, refetch: refetchRewardsTotal } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  /**
   * ===========
   * Reads (WeeklyRewardsDistributor)
   * ===========
   */
  const distReadsEnabled =
    mounted && !!effectiveChainId && distributorAddress !== zeroAddress && !!address;

  const { data: currentEpochRaw, refetch: refetchEpoch } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "currentEpoch",
    args: [],
    query: { enabled: distReadsEnabled },
  });

  const epochId = useMemo(() => {
    const v = currentEpochRaw as any;
    try {
      if (typeof v === "bigint") return v;
      if (v?.toString) return BigInt(v.toString());
    } catch {}
    return 0n;
  }, [currentEpochRaw]);

  const { data: isClaimedRaw, refetch: refetchClaimed } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "claimed",
    args: [epochId, (address ?? zeroAddress) as `0x${string}`],
    query: { enabled: distReadsEnabled && epochId > 0n },
  });

  const isClaimed = useMemo(() => Boolean(isClaimedRaw), [isClaimedRaw]);

  /**
   * ===========
   * Local state
   * ===========
   */
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const myCodeHex = (myPublicCode as Hex | undefined) ?? null;
  const haveCode = !!myCodeHex && isHex(myCodeHex) && myCodeHex.length === 66;

  const referralLink = useMemo(() => {
    if (!haveCode) return "";
    return `${SITE_ORIGIN}/play?ref=${myCodeHex}`;
  }, [haveCode, myCodeHex]);

  const isBound =
    (referrerOfMe as string | undefined) && (referrerOfMe as string) !== zeroAddress;

  async function registerCode() {
    setErr("");
    setStatus("");

    if (!mounted || !isConnected || !address) {
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

      await Promise.allSettled([refetchMyCode(), refetchLoss(), refetchRewardsTotal, refetchReferrer()]);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Register failed.");
    }
  }

  /**
   * ===========
   * 💰Rewards: Option C (GitHub raw)
   * ===========
   */
  const [bundle, setBundle] = useState<ClaimBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);

  const bundleUrl = useMemo(() => {
    if (!effectiveChainId || !address) return "";
    const userLower = address.toLowerCase();
    return `${GITHUB_RAW_BASE}/${effectiveChainId}/${userLower}.json`;
  }, [effectiveChainId, address]);

  async function fetchBundle() {
    setErr("");
    setStatus("");
    setBundle(null);

    if (!bundleUrl) {
      setErr("Connect wallet to load your claim bundle.");
      return;
    }

    setBundleLoading(true);
    try {
      const res = await fetch(bundleUrl, { cache: "no-store" });
      if (!res.ok) {
        setErr(`No bundle found for this week yet. (${res.status})`);
        return;
      }
      const j = (await res.json()) as ClaimBundle;

      // Light sanity checks
      if (!j?.user || j.user.toLowerCase() !== address!.toLowerCase()) {
        setErr("Bundle user mismatch.");
        return;
      }
      if (Number(j.chainId) !== Number(effectiveChainId)) {
        setErr("Bundle chainId mismatch.");
        return;
      }
      if (j.distributor && j.distributor.toLowerCase() !== distributorAddress.toLowerCase()) {
        setErr("Bundle distributor mismatch (wrong publish?).");
        return;
      }

      setBundle(j);
      setStatus("Bundle loaded ✅");
      window.setTimeout(() => setStatus(""), 800);
    } catch (e: any) {
      setErr(e?.message || "Failed to fetch bundle.");
    } finally {
      setBundleLoading(false);
    }
  }

  const bundleAmount = useMemo(() => {
    try {
      if (!bundle?.amount) return 0n;
      return BigInt(bundle.amount);
    } catch {
      return 0n;
    }
  }, [bundle]);

  const bundleGeneratedLoss = useMemo(() => {
    try {
      if (!bundle?.generatedLoss) return 0n;
      return BigInt(bundle.generatedLoss);
    } catch {
      return 0n;
    }
  }, [bundle]);

  const amountLabel = useMemo(() => {
    // Rewards are paid in DTC (18 decimals)
    try {
      return fmtNum(Number(formatUnits(bundleAmount, 18)), 6);
    } catch {
      return bundleAmount.toString();
    }
  }, [bundleAmount]);

  async function claimRewards() {
    setErr("");
    setStatus("");

    if (!mounted || !isConnected || !address) {
      setErr("Connect your wallet first.");
      return;
    }
    if (!effectiveChainId || distributorAddress === zeroAddress) {
      setErr("Unsupported chain for rewards.");
      return;
    }
    if (!publicClient) {
      setErr("No public client.");
      return;
    }
    if (wrongWalletForSelected) {
      setErr(`Switch wallet network to ${chainName} to claim on this chain.`);
      return;
    }
    if (!bundle) {
      setErr("Load your claim bundle first.");
      return;
    }
    if (isClaimed) {
      setErr("Already claimed for this epoch.");
      return;
    }

    try {
      setStatus("Confirm claim in wallet…");

      const hash = await writeContractAsync({
        chainId: effectiveChainId,
        abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
        address: distributorAddress,
        functionName: "claim",
        args: [
          BigInt(bundle.epochId),
          BigInt(bundle.amount),
          BigInt(bundle.generatedLoss),
          bundle.proof,
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Rewards claimed ✅");
      window.setTimeout(() => setStatus(""), 1200);

      await Promise.allSettled([refetchEpoch(), refetchClaimed(), refetchLoss(), refetchRewardsTotal()]);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Claim failed.");
    }
  }

  const canMutate =
    mounted &&
    isConnected &&
    !!address &&
    !!effectiveChainId &&
    !wrongWalletForSelected &&
    registryAddress !== zeroAddress;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Earn</h1>
              <p className="mt-2 text-neutral-300">
                Referrals are permanent (wallet-bound). Weekly rewards are claimable on-chain per network.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Viewing: <span className="text-neutral-100">{chainName}</span>
              {mounted && isConnected ? (
                <span className="ml-2 text-neutral-500">
                  (wallet: <span className="text-neutral-300">{walletNetworkName}</span>)
                </span>
              ) : null}
            </div>
          </div>

          {/* Network toggle (same UX as Home) */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Network</div>
                <div className="mt-1 text-xs text-neutral-500">
                  Selected:{" "}
                  <span className="font-semibold text-neutral-200">{selectedChain?.name ?? "—"}</span>
                </div>
              </div>

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

              {switchStatus ? <div className="text-[11px] text-amber-200">{switchStatus}</div> : null}

              {!mounted ? (
                <div className="text-[11px] text-neutral-600">Initializing…</div>
              ) : isConnected ? (
                <div className="text-[11px] text-neutral-600">
                  Wallet network:{" "}
                  <span className="text-neutral-300">
                    {isTokenChain(walletChainId)
                      ? chains.find((c) => c.chainId === walletChainId)?.name ?? walletChainId
                      : walletChainId ?? "—"}
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-neutral-600">
                  Not connected. The toggle will switch your wallet network after you connect.
                </div>
              )}

              <div className="text-[11px] text-neutral-600">
                Referral registry:{" "}
                <span className="font-mono text-neutral-400">{registryAddress}</span>
                <span className="mx-2 text-neutral-700">•</span>
                Distributor:{" "}
                <span className="font-mono text-neutral-400">{distributorAddress}</span>
                <span className="mx-2 text-neutral-700">•</span>
                Token: <span className="font-mono text-neutral-400">{tokenAddress}</span>
              </div>

              {mounted && isConnected && wrongWalletForSelected ? (
                <div className="text-[11px] text-amber-200/90">
                  You’re viewing <b>{chainName}</b>, but your wallet is on <b>{walletNetworkName}</b>. Switch to claim/register.
                </div>
              ) : null}
            </div>
          </div>

          {/* Wallet card */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 text-sm text-neutral-300">
              {mounted && isConnected && address ? `Connected: ${truncateAddr(address)}` : "Not connected"}
            </div>
          </div>

          {/* 💰Rewards */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Weekly claims via Merkle proof. Load your bundle, then claim on-chain.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchBundle()}
                  disabled={!bundleUrl || bundleLoading}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !bundleUrl || bundleLoading
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  {bundleLoading ? "LOADING…" : "LOAD BUNDLE"}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (!bundleUrl) return;
                    const ok = await copyText(bundleUrl);
                    if (ok) {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 900);
                    }
                  }}
                  disabled={!bundleUrl}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    bundleUrl
                      ? "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60"
                      : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                  ].join(" ")}
                >
                  {copied ? "COPIED" : "COPY URL"}
                </button>

                <button
                  type="button"
                  onClick={() => void claimRewards()}
                  disabled={!mounted || !isConnected || wrongWalletForSelected || !bundle || isClaimed}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !mounted || !isConnected || wrongWalletForSelected || !bundle || isClaimed
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                  ].join(" ")}
                >
                  {isClaimed ? "CLAIMED" : "CLAIM"}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Epoch</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{epochId.toString()}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Bundle amount (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {bundle ? amountLabel : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Status</div>
                <div className="mt-1 text-sm text-neutral-200">
                  {isClaimed ? "Already claimed" : bundle ? "Ready to claim" : "Load your bundle"}
                </div>
              </div>
            </div>

            {bundleUrl ? (
              <div className="mt-3 text-[12px] text-neutral-500">
                Bundle source: <span className="break-all font-mono text-neutral-300">{bundleUrl}</span>
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-neutral-500">Connect wallet to compute your bundle URL.</div>
            )}

            {bundle ? (
              <div className="mt-2 text-[11px] text-neutral-600">
                Bundle inputs → epochId <span className="font-mono">{bundle.epochId}</span>, amount{" "}
                <span className="font-mono">{bundle.amount}</span>, generatedLoss{" "}
                <span className="font-mono">{bundle.generatedLoss}</span>, proof{" "}
                <span className="font-mono">{bundle.proof.length}</span> hashes
              </div>
            ) : null}
          </div>

          {/* Referrer binding */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Your referrer</div>
            <div className="mt-2 text-sm text-neutral-300">
              {mounted && isConnected && address ? (
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
                  Share this link. Users will bind automatically on their first token game.
                </div>
              </div>

              <button
                type="button"
                onClick={() => void registerCode()}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                disabled={!mounted || !isConnected || registryAddress === zeroAddress || !canMutate}
                title={!canMutate && wrongWalletForSelected ? `Switch wallet to ${chainName}` : undefined}
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
              <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                {haveCode ? referralLink : "—"}
              </div>

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
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(frensLossRaw as any)?.toString?.() ?? "0"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Frens won</div>
                <div className="mt-1 text-sm text-neutral-500">
                  Not available yet (missing in ReferralRegistry ABI)
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Total rewards</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(totalRewardsRaw as any)?.toString?.() ?? "0"}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              Totals update as gameplay + weekly distributions occur.
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
