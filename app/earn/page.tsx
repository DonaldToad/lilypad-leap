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
import { zeroAddress, type Hex, isHex, formatUnits } from "viem";

import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import { REFERRAL_REGISTRY_ABI } from "../lib/abi/referralRegistry";
import { WEEKLY_REWARDS_DISTRIBUTOR_ABI } from "../lib/abi/weeklyRewardsDistributor";
import { REF_REGISTRY_BY_CHAIN, WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN } from "../lib/addresses";

const SITE_ORIGIN = "https://hop.donaldtoad.com";

// Earn supported chains (Linea + Base)
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
 * Claim bundle format (user pastes)
 * ==========================
 * {
 *   "epochId": 12,
 *   "amount": "123000000000000000000",        // wei
 *   "generatedLoss": "456000000000000000000",  // wei or raw units (whatever your tree uses)
 *   "proof": ["0x...", "0x..."]
 * }
 */
type ClaimBundle = {
  epochId: number;
  amount: string; // bigint string
  generatedLoss: string; // bigint string
  proof: string[];
};

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted;

  // Home-like: only show Linea + Base (stable order)
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

  const effectiveChainId = ready ? selectedChainId : undefined;

  const selectedChain = useMemo(() => {
    return chains.find((c) => c.chainId === selectedChainId) ?? PRIMARY_CHAIN;
  }, [chains, selectedChainId]);

  const chainName = selectedChain?.name ?? "—";

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

  const readsEnabled =
    ready && !!effectiveChainId && isConnected && !!address && registryAddress !== zeroAddress;

  // ==========================
  // ReferralRegistry reads
  // ==========================
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

  const { data: myRewardsTotalRaw, refetch: refetchRewardsTotal } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  // NOTE: Your registry ABI currently does NOT include a "won" function.
  // We keep the UI slot and show "—" until you add it.
  const frensWonRaw: bigint | undefined = undefined;

  // ==========================
  // WeeklyRewardsDistributor reads
  // ==========================
  const distributorReadsEnabled =
    ready && !!effectiveChainId && isConnected && !!address && distributorAddress !== zeroAddress;

  const { data: currentEpochRaw, refetch: refetchEpoch } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "currentEpoch",
    args: [],
    query: { enabled: distributorReadsEnabled },
  });

  const currentEpoch = useMemo(() => {
    const v = currentEpochRaw as any;
    try {
      if (typeof v === "bigint") return Number(v);
      if (v?.toString) return Number(v.toString());
    } catch {}
    return 0;
  }, [currentEpochRaw]);

  const { data: epochInfoRaw, refetch: refetchEpochInfo } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "epochs",
    args: [BigInt(currentEpoch || 0)],
    query: { enabled: distributorReadsEnabled && currentEpoch > 0 },
  });

  const { data: claimedRaw, refetch: refetchClaimed } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "claimed",
    args: [BigInt(currentEpoch || 0), address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: distributorReadsEnabled && currentEpoch > 0 },
  });

  const alreadyClaimed = !!claimedRaw;

  const epochWindowLabel = useMemo(() => {
    // epochs(epochId) returns tuple: (merkleRoot, start, end, totalFunded)
    const v = epochInfoRaw as any;
    if (!v) return "—";
    try {
      const start = typeof v[1] === "bigint" ? Number(v[1]) : Number(v.start ?? 0);
      const end = typeof v[2] === "bigint" ? Number(v[2]) : Number(v.end ?? 0);
      if (!start || !end) return "—";
      const s = new Date(start * 1000);
      const e = new Date(end * 1000);
      return `${s.toISOString().slice(0, 10)} → ${e.toISOString().slice(0, 10)}`;
    } catch {
      return "—";
    }
  }, [epochInfoRaw]);

  // ==========================
  // UI state
  // ==========================
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

  const canMutate =
    ready &&
    isConnected &&
    !!address &&
    !!effectiveChainId &&
    registryAddress !== zeroAddress &&
    distributorAddress !== zeroAddress &&
    !wrongWalletForSelected;

  const [switchStatus, setSwitchStatus] = useState<string>("");

  async function onPickChain(chainId: number) {
    setSwitchStatus("");
    setSelectedChainId(chainId);

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

      await Promise.allSettled([refetchMyCode(), refetchLoss(), refetchRewardsTotal(), refetchReferrer()]);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Register failed.");
    }
  }

  // Claim bundle text area
  const [bundleText, setBundleText] = useState<string>("");
  const [parsedBundle, setParsedBundle] = useState<ClaimBundle | null>(null);
  const [bundleError, setBundleError] = useState<string>("");

  useEffect(() => {
    if (!bundleText.trim()) {
      setParsedBundle(null);
      setBundleError("");
      return;
    }
    try {
      const j = JSON.parse(bundleText) as ClaimBundle;
      if (
        typeof j?.epochId !== "number" ||
        typeof j?.amount !== "string" ||
        typeof j?.generatedLoss !== "string" ||
        !Array.isArray(j?.proof)
      ) {
        throw new Error("Invalid bundle shape.");
      }
      // quick sanity
      BigInt(j.amount);
      BigInt(j.generatedLoss);
      setParsedBundle(j);
      setBundleError("");
    } catch (e: any) {
      setParsedBundle(null);
      setBundleError(e?.message || "Invalid JSON bundle.");
    }
  }, [bundleText]);

  const pendingRewardsLabel = useMemo(() => {
    // We cannot compute “pending” on-chain without proof data.
    // We display amount from parsed bundle if present, else "—"
    if (!parsedBundle) return "—";
    try {
      const amt = BigInt(parsedBundle.amount);
      // assuming 18 decimals (DTC). If different, change 18.
      const asToken = Number(formatUnits(amt, 18));
      return fmtNum(asToken, 6);
    } catch {
      return "—";
    }
  }, [parsedBundle]);

  async function claimRewardsFromBundle() {
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
    if (!parsedBundle) {
      setErr("Paste a valid claim bundle first.");
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
          BigInt(parsedBundle.epochId),
          BigInt(parsedBundle.amount),
          BigInt(parsedBundle.generatedLoss),
          parsedBundle.proof as any,
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Rewards claimed ✅");
      window.setTimeout(() => setStatus(""), 1200);

      await Promise.allSettled([refetchClaimed(), refetchRewardsTotal(), refetchLoss()]);
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
                Referrals are permanent (wallet-bound). Weekly rewards are claimable on-chain per network.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Network: <span className="text-neutral-100">{selectedChain?.name ?? "—"}</span>
            </div>
          </div>

          {/* Home-like toggle (same layout + LIVE pill) */}
          <div className="mt-6">
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
                Not connected. Toggle will switch your wallet network after you connect.
              </div>
            )}
          </div>

          {/* Wallet card */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 text-sm text-neutral-300">
              {ready && isConnected && address ? `Connected: ${truncateAddr(address)}` : "Not connected"}
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="text-[12px] text-neutral-500">
                Registry:{" "}
                <span className="font-mono text-neutral-300">
                  {registryAddress !== zeroAddress ? registryAddress : "—"}
                </span>
              </div>
              <div className="text-[12px] text-neutral-500">
                Distributor:{" "}
                <span className="font-mono text-neutral-300">
                  {distributorAddress !== zeroAddress ? distributorAddress : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* 💰Rewards */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Claim requires a weekly Merkle claim bundle (epochId + amount + generatedLoss + proof).
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const txt = `Chain: ${chainName}\nEpoch: ${currentEpoch || "—"}\nWindow: ${epochWindowLabel}\nWallet: ${
                      address ?? "—"
                    }\nClaimed: ${alreadyClaimed ? "yes" : "no"}\nBundleAmount: ${pendingRewardsLabel}`;
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
                  onClick={() => void claimRewardsFromBundle()}
                  disabled={!canMutate || !parsedBundle || alreadyClaimed}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !canMutate || !parsedBundle || alreadyClaimed
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
                <div className="text-[12px] text-neutral-400">Current epoch</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{currentEpoch || "—"}</div>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Epoch window</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{epochWindowLabel}</div>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Pending (from bundle)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{pendingRewardsLabel}</div>
              </div>
            </div>

            <div className="mt-3">
              <div className="text-[12px] font-semibold text-neutral-100">Paste claim bundle JSON</div>
              <textarea
                value={bundleText}
                onChange={(e) => setBundleText(e.target.value)}
                placeholder={`{"epochId":${currentEpoch || 0},"amount":"0","generatedLoss":"0","proof":["0x..."]}`}
                className="mt-2 h-32 w-full resize-none rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 font-mono text-[12px] text-neutral-100 outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              {bundleError ? (
                <div className="mt-2 text-[11px] text-amber-200">{bundleError}</div>
              ) : parsedBundle ? (
                <div className="mt-2 text-[11px] text-neutral-500">
                  Bundle ok • epochId={parsedBundle.epochId} • proofItems={parsedBundle.proof.length}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-neutral-600">Paste a bundle to enable claim.</div>
              )}
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
                disabled={!ready || !isConnected || registryAddress === zeroAddress || !canMutate}
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
                <div className="mt-1 font-mono text-sm text-neutral-200">{frensWonRaw ? frensWonRaw.toString() : "—"}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Total rewards</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(myRewardsTotalRaw as any)?.toString?.() ?? "0"}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              Rewards totals update after you publish the weekly Merkle root and users claim via the distributor.
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
