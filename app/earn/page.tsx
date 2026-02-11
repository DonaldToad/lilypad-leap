// app/earn/page.tsx
"use client";

import TopNav from "../components/TopNav";
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  zeroAddress,
  type Hex,
  isHex,
  formatUnits,
  isAddress,
} from "viem";

import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import { REFERRAL_REGISTRY_ABI } from "../lib/abi/referralRegistry";
import { WEEKLY_REWARDS_DISTRIBUTOR_ABI } from "../lib/abi/weeklyRewardsDistributor";
import {
  REF_REGISTRY_BY_CHAIN,
  WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN,
} from "../lib/addresses";

const SITE_ORIGIN = "https://hop.donaldtoad.com";

// Only the chains you actually want here (same as Home)
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

type ClaimBundle = {
  chainId: number;
  user: `0x${string}`;
  epochId: string; // decimal
  amount: string; // decimal (token units, e.g. 18 decimals)
  generatedLoss: string; // decimal
  proof: `0x${string}`[];
  tokenSymbol?: string;
  tokenDecimals?: number;
};

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted;

  // Home-like chain list (stable order: Linea then Base)
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

  const effectiveChainId = ready ? selectedChainId : undefined;

  const chainName = useMemo(() => {
    if (!effectiveChainId) return "—";
    return CHAIN_LIST.find((c) => c.chainId === effectiveChainId)?.name ?? String(effectiveChainId);
  }, [effectiveChainId]);

  const registryAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (REF_REGISTRY_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const distributorAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const wrongWalletForSelected = useMemo(() => {
    if (!ready || !isConnected) return false;
    if (!effectiveChainId || !walletChainId) return false;
    return walletChainId !== effectiveChainId;
  }, [ready, isConnected, walletChainId, effectiveChainId]);

  const [switchStatus, setSwitchStatus] = useState<string>("");

  async function onPickChain(nextChainId: number) {
    setSwitchStatus("");
    setSelectedChainId(nextChainId);

    if (!ready) return;
    if (!isConnected) {
      setSwitchStatus("Connect your wallet to switch network.");
      return;
    }
    try {
      await switchChainAsync?.({ chainId: nextChainId });
      setSwitchStatus("");
    } catch (e: any) {
      setSwitchStatus(e?.shortMessage || e?.message || "Network switch failed.");
    }
  }

  // ===== Reads: ReferralRegistry =====
  const readsEnabled =
    ready &&
    !!effectiveChainId &&
    isConnected &&
    !!address &&
    registryAddress !== zeroAddress;

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

  const { data: totalRewardsRaw, refetch: refetchTotalRewards } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  // Optional (won) — NOT in your current ABI, so we do a safe best-effort call via publicClient.
  const [frensWonRaw, setFrensWonRaw] = useState<bigint | null>(null);
  const loadFrensWon = useCallback(async () => {
    if (!publicClient || !effectiveChainId || !address || registryAddress === zeroAddress) {
      setFrensWonRaw(null);
      return;
    }
    try {
      const v = (await publicClient.readContract({
        chainId: effectiveChainId,
        address: registryAddress,
        abi: [
          {
            type: "function",
            name: "referrer_total_generated_won",
            stateMutability: "view",
            inputs: [{ name: "referrer", type: "address" }],
            outputs: [{ name: "won", type: "uint256" }],
          },
        ] as const,
        functionName: "referrer_total_generated_won",
        args: [address],
      })) as bigint;

      setFrensWonRaw(v);
    } catch {
      // Contract likely doesn't implement it — keep UI stable.
      setFrensWonRaw(null);
    }
  }, [publicClient, effectiveChainId, address, registryAddress]);

  useEffect(() => {
    if (!readsEnabled) {
      setFrensWonRaw(null);
      return;
    }
    void loadFrensWon();
  }, [readsEnabled, loadFrensWon]);

  // ===== Rewards: Distributor reads =====
  const distributorReadsEnabled =
    ready &&
    !!effectiveChainId &&
    isConnected &&
    !!address &&
    distributorAddress !== zeroAddress;

  const { data: currentEpochRaw, refetch: refetchEpoch } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "currentEpoch",
    args: [],
    query: { enabled: distributorReadsEnabled },
  });

  const currentEpoch = (currentEpochRaw as bigint | undefined) ?? 0n;

  const { data: alreadyClaimedRaw, refetch: refetchClaimed } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "claimed",
    args: [currentEpoch, (address ?? zeroAddress) as `0x${string}`],
    query: { enabled: distributorReadsEnabled && !!address },
  });

  const alreadyClaimed = (alreadyClaimedRaw as boolean | undefined) ?? false;

  // ===== Claim bundle UX =====
  const [bundle, setBundle] = useState<ClaimBundle | null>(null);
  const [bundleStatus, setBundleStatus] = useState<string>("");
  const [bundleErr, setBundleErr] = useState<string>("");

  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");

  const [copied, setCopied] = useState(false);
  const [rewardCopied, setRewardCopied] = useState(false);

  const myCodeHex = (myPublicCode as Hex | undefined) ?? null;
  const haveCode = !!myCodeHex && isHex(myCodeHex) && myCodeHex.length === 66;

  const referralLink = useMemo(() => {
    if (!haveCode) return "";
    return `${SITE_ORIGIN}/play?ref=${myCodeHex}`;
  }, [haveCode, myCodeHex]);

  const isBound = (referrerOfMe as string | undefined) && (referrerOfMe as string) !== zeroAddress;

  const tokenDecimals = bundle?.tokenDecimals ?? 18;
  const tokenSymbol = bundle?.tokenSymbol ?? "DTC";

  const pendingAmount = useMemo(() => {
    try {
      if (!bundle?.amount) return 0n;
      return BigInt(bundle.amount);
    } catch {
      return 0n;
    }
  }, [bundle]);

  const pendingLabel = useMemo(() => {
    try {
      const n = Number(formatUnits(pendingAmount, tokenDecimals));
      return `${fmtNum(n, 6)} ${tokenSymbol}`;
    } catch {
      return `${pendingAmount.toString()} ${tokenSymbol}`;
    }
  }, [pendingAmount, tokenDecimals, tokenSymbol]);

  const canMutate =
    ready &&
    isConnected &&
    !!address &&
    !!effectiveChainId &&
    registryAddress !== zeroAddress &&
    distributorAddress !== zeroAddress &&
    !wrongWalletForSelected;

  const loadBundle = useCallback(async () => {
    setBundleErr("");
    setBundleStatus("");

    if (!effectiveChainId) return;
    if (!address || !isAddress(address)) {
      setBundle(null);
      setBundleStatus("Connect wallet to check rewards.");
      return;
    }

    try {
      setBundleStatus("Checking rewards…");
      const r = await fetch(`/api/claim-bundle?chainId=${effectiveChainId}&user=${address}`, {
        cache: "no-store",
      });
      const j = await r.json();

      if (!r.ok || !j?.ok) {
        setBundle(null);
        setBundleStatus("");
        setBundleErr(j?.error || "Failed to load claim bundle.");
        return;
      }

      const b = (j.bundle ?? null) as ClaimBundle | null;
      setBundle(b);
      setBundleStatus(b ? "Rewards found ✅" : "No pending rewards.");
    } catch (e: any) {
      setBundle(null);
      setBundleStatus("");
      setBundleErr(e?.message || "Failed to load claim bundle.");
    }
  }, [effectiveChainId, address]);

  // Auto-check bundle when chain/wallet changes (user-friendly)
  useEffect(() => {
    if (!ready) return;
    if (!effectiveChainId) return;
    if (!isConnected || !address) {
      setBundle(null);
      setBundleStatus("");
      setBundleErr("");
      return;
    }
    void loadBundle();
  }, [ready, effectiveChainId, isConnected, address, loadBundle]);

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

      await Promise.allSettled([refetchMyCode(), refetchLoss(), refetchTotalRewards(), refetchReferrer()]);
      await loadFrensWon();
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Register failed.");
    }
  }

  async function claimRewards() {
    setErr("");
    setStatus("");

    if (!ready || !isConnected || !address) {
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
      setErr("No claim bundle found. Click “Check rewards” first.");
      return;
    }

    let epochId = 0n;
    let amount = 0n;
    let generatedLoss = 0n;

    try {
      epochId = BigInt(bundle.epochId);
      amount = BigInt(bundle.amount);
      generatedLoss = BigInt(bundle.generatedLoss);
    } catch {
      setErr("Invalid bundle numbers.");
      return;
    }

    if (amount <= 0n) {
      setErr("No pending rewards to claim.");
      return;
    }

    try {
      setStatus("Confirm claim in wallet…");

      const hash = await writeContractAsync({
        chainId: effectiveChainId,
        abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
        address: distributorAddress,
        functionName: "claim",
        args: [epochId, amount, generatedLoss, bundle.proof],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Rewards claimed ✅");
      window.setTimeout(() => setStatus(""), 1200);

      // refresh everything relevant
      await Promise.allSettled([
        refetchEpoch(),
        refetchClaimed(),
        refetchLoss(),
        refetchTotalRewards(),
        loadFrensWon(),
      ]);
      await loadBundle();
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Claim failed.");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Earn</h1>
              <p className="mt-2 text-neutral-300">
                Referrals are wallet-bound. Weekly rewards are claimable on-chain per network.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Network: <span className="text-neutral-100">{selectedChain?.name ?? chainName}</span>
            </div>
          </div>

          {/* Home-like chain toggle */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
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
                Not connected. Connect to read stats and claim rewards.
              </div>
            )}
          </div>

          {/* Wallet card */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 text-sm text-neutral-300">
              {ready && isConnected && address ? `Connected: ${truncateAddr(address)}` : "Not connected"}
            </div>

            <div className="mt-2 text-[12px] text-neutral-500">
              Registry:{" "}
              {registryAddress !== zeroAddress ? (
                <span className="font-mono text-neutral-300">{registryAddress}</span>
              ) : (
                "—"
              )}
            </div>
            <div className="mt-1 text-[12px] text-neutral-500">
              Distributor:{" "}
              {distributorAddress !== zeroAddress ? (
                <span className="font-mono text-neutral-300">{distributorAddress}</span>
              ) : (
                "—"
              )}
            </div>

            {ready && isConnected && wrongWalletForSelected ? (
              <div className="mt-2 text-[12px] text-amber-200/90">
                You’re viewing <b>{chainName}</b>, but your wallet is on <b>{walletChainId}</b>. Switch network to claim/register.
              </div>
            ) : null}
          </div>

          {/* 💰Rewards box */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Weekly rewards are claimed via Merkle proof (bundle fetched automatically).
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadBundle()}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                >
                  CHECK REWARDS
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const txt = `Chain: ${chainName}\nUser: ${address ?? "—"}\nPending: ${pendingLabel}\nEpoch: ${bundle?.epochId ?? "—"}`;
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
                  onClick={() => void claimRewards()}
                  disabled={!canMutate || !bundle || pendingAmount <= 0n || alreadyClaimed}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !canMutate || !bundle || pendingAmount <= 0n || alreadyClaimed
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                  ].join(" ")}
                >
                  {alreadyClaimed ? "CLAIMED" : "CLAIM"}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Pending</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{pendingLabel}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Epoch</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {bundle?.epochId ?? (currentEpoch ? currentEpoch.toString() : "—")}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Claim status</div>
                <div className="mt-1 text-sm text-neutral-200">
                  {isConnected ? (alreadyClaimed ? "Already claimed ✅" : "Not claimed") : "Connect wallet"}
                </div>
              </div>
            </div>

            {bundleStatus ? (
              <div className="mt-3 text-[12px] text-neutral-300">{bundleStatus}</div>
            ) : null}
            {bundleErr ? (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
                {bundleErr}
              </div>
            ) : null}

            <div className="mt-3 text-[11px] text-neutral-600">
              Source: <span className="font-mono">/api/claim-bundle?chainId={effectiveChainId ?? "—"}&amp;user={address ?? "—"}</span>
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
                  Share this link. Users will bind automatically on their first token game.
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
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {frensWonRaw === null ? "—" : frensWonRaw.toString()}
                </div>
                <div className="mt-1 text-[11px] text-neutral-600">
                  If you want this, we must add it to the registry contract (not in ABI now).
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
              Totals update after weekly distributions are posted + claims occur.
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
