// app/earn/page.tsx
"use client";

import TopNav from "../components/TopNav";
import React, { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWriteContract,
  usePublicClient,
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
 * ==========================
 * Option C: GitHub RAW bundles
 * ==========================
 * Put bundles in a public repo and serve via raw.githubusercontent.com
 *
 * Example:
 * https://raw.githubusercontent.com/DonaldToad/lilypad-claims/main/claims/59144/12/0xabc....json
 */
const CLAIMS_BASE_URL =
  "https://raw.githubusercontent.com/DonaldToad/lilypad-claims/main/claims"; // <-- CHANGE ME

// Token-mode chains you support (Linea + Base)
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
 * WeeklyRewardsDistributor ABI (minimal: reads + claim)
 */
const WEEKLY_REWARDS_DISTRIBUTOR_ABI = [
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
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

type ClaimBundle = {
  epochId: number | string;
  amount: string; // uint256 as string
  generatedLoss: string; // uint256 as string
  proof: `0x${string}`[];
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

  // Only show Linea + Base (stable order)
  const chains = useMemo(() => {
    const filtered = CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any));
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort((a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99));
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(59144);

  // Mirror wallet network when wallet is on a supported chain
  useEffect(() => {
    if (!ready) return;
    if (isTokenChain(walletChainId)) setSelectedChainId(walletChainId);
  }, [ready, walletChainId]);

  const selectedChain = useMemo(() => {
    return chains.find((c) => c.chainId === selectedChainId) ?? chains[0];
  }, [chains, selectedChainId]);

  const chainName = selectedChain?.name ?? "—";

  const registryAddress = useMemo(() => {
    return (REF_REGISTRY_BY_CHAIN[selectedChainId] ?? zeroAddress) as `0x${string}`;
  }, [selectedChainId]);

  const distributorAddress = useMemo(() => {
    return (WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN[selectedChainId] ?? zeroAddress) as `0x${string}`;
  }, [selectedChainId]);

  const tokenAddress = useMemo(() => {
    return (DTC_BY_CHAIN[selectedChainId] ?? zeroAddress) as `0x${string}`;
  }, [selectedChainId]);

  const wrongWalletForSelected = useMemo(() => {
    if (!ready || !isConnected) return false;
    if (!walletChainId) return false;
    return walletChainId !== selectedChainId;
  }, [ready, isConnected, walletChainId, selectedChainId]);

  const readsEnabled =
    ready && isConnected && !!address && registryAddress !== zeroAddress && distributorAddress !== zeroAddress;

  // -------------------------
  // Referral registry reads
  // -------------------------
  const { data: referrerOfMe, refetch: refetchReferrer } = useReadContract({
    chainId: selectedChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrerOf",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  const { data: myPublicCode, refetch: refetchMyCode } = useReadContract({
    chainId: selectedChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "publicCodeOf",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  const { data: frensLossRaw, refetch: refetchLoss } = useReadContract({
    chainId: selectedChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_generated_loss",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  const { data: totalRewardsRaw, refetch: refetchRewards } = useReadContract({
    chainId: selectedChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  // -------------------------
  // Distributor reads (epoch + claimed)
  // -------------------------
  const { data: currentEpochRaw, refetch: refetchEpoch } = useReadContract({
    chainId: selectedChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "currentEpoch",
    args: [],
    query: { enabled: ready && distributorAddress !== zeroAddress },
  });

  const currentEpoch = useMemo(() => {
    const v = currentEpochRaw as any;
    try {
      if (typeof v === "bigint") return Number(v);
      if (v?.toString) return Number(v.toString());
    } catch {}
    return 0;
  }, [currentEpochRaw]);

  const { data: alreadyClaimedRaw, refetch: refetchClaimed } = useReadContract({
    chainId: selectedChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "claimed",
    args: [BigInt(currentEpoch || 0), (address ?? zeroAddress) as `0x${string}`],
    query: { enabled: ready && !!address && distributorAddress !== zeroAddress && currentEpoch > 0 },
  });

  const alreadyClaimed = !!alreadyClaimedRaw;

  // -------------------------
  // UI state
  // -------------------------
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [bundleCopied, setBundleCopied] = useState(false);

  const myCodeHex = (myPublicCode as Hex | undefined) ?? null;
  const haveCode = !!myCodeHex && isHex(myCodeHex) && myCodeHex.length === 66;

  const referralLink = useMemo(() => {
    if (!haveCode) return "";
    return `${SITE_ORIGIN}/play?ref=${myCodeHex}`;
  }, [haveCode, myCodeHex]);

  const isBound = (referrerOfMe as string | undefined) && (referrerOfMe as string) !== zeroAddress;

  // -------------------------
  // Claim bundle handling
  // -------------------------
  const [bundle, setBundle] = useState<ClaimBundle | null>(null);
  const [bundleState, setBundleState] = useState<
    "idle" | "loading" | "found" | "missing" | "badjson"
  >("idle");

  const bundleUrl = useMemo(() => {
    if (!address || !currentEpoch || !selectedChainId) return "";
    const user = address.toLowerCase();
    return `${CLAIMS_BASE_URL}/${selectedChainId}/${currentEpoch}/${user}.json`;
  }, [address, currentEpoch, selectedChainId]);

  async function loadBundle() {
    setErr("");
    setStatus("");
    setBundle(null);

    if (!bundleUrl) {
      setErr("Connect wallet and wait for current epoch to load.");
      return;
    }

    try {
      setBundleState("loading");
      const r = await fetch(bundleUrl, { cache: "no-store" });
      if (!r.ok) {
        setBundleState("missing");
        return;
      }
      const j = (await r.json()) as ClaimBundle;
      if (!j || !j.amount || !j.generatedLoss || !Array.isArray(j.proof)) {
        setBundleState("badjson");
        return;
      }
      setBundle(j);
      setBundleState("found");
    } catch {
      setBundleState("badjson");
    }
  }

  const canMutate =
    ready &&
    isConnected &&
    !!address &&
    registryAddress !== zeroAddress &&
    distributorAddress !== zeroAddress &&
    !wrongWalletForSelected;

  async function onPickChain(chainId: number) {
    setErr("");
    setStatus("");
    setBundle(null);
    setBundleState("idle");
    setSelectedChainId(chainId);

    // Same behavior as Home: try to switch wallet if connected
    if (!ready) return;
    if (!isConnected) return;

    try {
      await switchChainAsync?.({ chainId });
    } catch {
      // user may reject; still allow viewing
    }
  }

  async function registerCode() {
    setErr("");
    setStatus("");

    if (!ready || !isConnected || !address) return setErr("Connect your wallet first.");
    if (registryAddress === zeroAddress) return setErr("Referral registry not deployed on this chain.");
    if (!publicClient) return setErr("No public client.");
    if (wrongWalletForSelected) return setErr(`Switch wallet network to ${chainName} to register on this chain.`);

    try {
      setStatus("Confirm in wallet…");
      const hash = await writeContractAsync({
        chainId: selectedChainId,
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

  async function claimRewards() {
    setErr("");
    setStatus("");

    if (!ready || !isConnected || !address) return setErr("Connect your wallet first.");
    if (!publicClient) return setErr("No public client.");
    if (distributorAddress === zeroAddress) return setErr("Rewards distributor not deployed on this chain.");
    if (wrongWalletForSelected) return setErr(`Switch wallet network to ${chainName} to claim on this chain.`);
    if (!bundle) return setErr("Load your claim bundle first.");
    if (alreadyClaimed) return setErr("Already claimed for this epoch.");
    if (Number(bundle.epochId) !== currentEpoch) return setErr("Bundle epoch does not match current epoch.");

    try {
      setStatus("Confirm claim in wallet…");

      const hash = await writeContractAsync({
        chainId: selectedChainId,
        abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
        address: distributorAddress,
        functionName: "claim",
        args: [
          BigInt(currentEpoch),
          BigInt(bundle.amount),
          BigInt(bundle.generatedLoss),
          bundle.proof,
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Rewards claimed ✅");
      window.setTimeout(() => setStatus(""), 1200);

      await Promise.allSettled([refetchClaimed(), refetchLoss(), refetchRewards()]);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Claim failed.");
    }
  }

  const pendingAmountLabel = useMemo(() => {
    if (!bundle) return "—";
    try {
      const asToken = Number(formatUnits(BigInt(bundle.amount), 18));
      return `${fmtNum(asToken, 6)} DTC`;
    } catch {
      return bundle.amount;
    }
  }, [bundle]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Earn</h1>
              <p className="mt-2 text-neutral-300">
                Referrals are wallet-bound. Weekly rewards are claimable per chain via Merkle proofs.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Viewing: <span className="text-neutral-100">{chainName}</span>
            </div>
          </div>

          {/* Home-style chain toggle */}
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
                {wrongWalletForSelected ? (
                  <span className="ml-2 text-amber-200">
                    (switch to {chainName} to register/claim)
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-neutral-600">
                Not connected. Connect wallet to register and claim.
              </div>
            )}
          </div>

          {/* Wallet card */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 text-sm text-neutral-300">
              {ready && isConnected && address ? `Connected: ${truncateAddr(address)}` : "Not connected"}
            </div>

            <div className="mt-2 text-[12px] text-neutral-500">
              Token: <span className="font-mono text-neutral-300">{tokenAddress}</span>
            </div>
            <div className="mt-1 text-[12px] text-neutral-500">
              Registry: <span className="font-mono text-neutral-300">{registryAddress}</span>
            </div>
            <div className="mt-1 text-[12px] text-neutral-500">
              Distributor: <span className="font-mono text-neutral-300">{distributorAddress}</span>
            </div>
          </div>

          {/* 💰 Rewards box */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Current epoch: <span className="font-mono text-neutral-300">{currentEpoch || "—"}</span>
                  {ready && isConnected && alreadyClaimed ? (
                    <span className="ml-2 rounded-full bg-neutral-50/10 px-2 py-0.5 text-[11px] font-semibold text-neutral-200 ring-1 ring-neutral-200/20">
                      ALREADY CLAIMED
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadBundle()}
                  disabled={!ready || !isConnected || !address || !currentEpoch}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !ready || !isConnected || !address || !currentEpoch
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  LOAD BUNDLE
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const txt = bundleUrl ? bundleUrl : "—";
                    const ok = await copyText(txt);
                    if (ok) {
                      setBundleCopied(true);
                      window.setTimeout(() => setBundleCopied(false), 900);
                    }
                  }}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                >
                  {bundleCopied ? "COPIED" : "COPY URL"}
                </button>

                <button
                  type="button"
                  onClick={() => void claimRewards()}
                  disabled={!canMutate || !bundle || alreadyClaimed}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !canMutate || !bundle || alreadyClaimed
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                  ].join(" ")}
                >
                  CLAIM
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="text-[12px] text-neutral-400">Bundle source (GitHub raw)</div>
              <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                {bundleUrl || "—"}
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[12px] text-neutral-400">Status</div>
                  <div className="mt-1 text-sm font-semibold text-neutral-100">
                    {bundleState === "idle"
                      ? "—"
                      : bundleState === "loading"
                      ? "Loading…"
                      : bundleState === "found"
                      ? "Found ✅"
                      : bundleState === "missing"
                      ? "Not found"
                      : "Bad JSON"}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[12px] text-neutral-400">Pending reward</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">{pendingAmountLabel}</div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[12px] text-neutral-400">Proof items</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">
                    {bundle?.proof?.length ?? 0}
                  </div>
                </div>
              </div>

              {bundleState === "missing" ? (
                <div className="mt-3 text-[12px] text-amber-200">
                  No bundle published for your address yet. If you expected rewards, your weekly output hasn’t been pushed to GitHub.
                </div>
              ) : null}

              <div className="mt-3 text-[12px] text-neutral-500">
                Tip: publish bundles under{" "}
                <span className="font-mono text-neutral-300">
                  {`claims/${selectedChainId}/${currentEpoch}/${address ? address.toLowerCase() : "0x…"} .json`}
                </span>
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

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Frens loss</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(frensLossRaw as any)?.toString?.() ?? "0"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Frens won</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(totalRewardsRaw as any)?.toString?.() ?? "0"}
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">Mapped to referrer_total_rewards</div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              These update after weekly epochs are posted and users claim.
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
