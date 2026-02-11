// app/earn/page.tsx
"use client";

import TopNav from "../components/TopNav";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
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
 * ==========================
 * Option C: GitHub RAW bundle URL
 * ==========================
 * Put claim bundles somewhere public, e.g.:
 *   https://raw.githubusercontent.com/<OWNER>/<REPO>/<BRANCH>/claims/<chainId>/<user>.json
 *
 * Example structure:
 *   claims/59144/0xabc....json
 *   claims/8453/0xabc....json
 *
 * The JSON must be:
 * {
 *   "epochId": 12,
 *   "amount": "123000000000000000000",        // uint256 as string (wei)
 *   "generatedLoss": "456000000000000000000", // uint256 as string (wei)
 *   "proof": ["0x...", "0x..."]
 * }
 */
const CLAIMS_GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/DonaldToad/lilypad-leap-claims/main/claims";

function claimBundleUrl(chainId: number, user: string) {
  // IMPORTANT: filenames in the repo are lowercase; GitHub paths are case-sensitive
  const u = (user || "").toLowerCase();
  return `${CLAIMS_GITHUB_RAW_BASE}/${chainId}/${u}.json`;
}


// Minimal ABI for WeeklyRewardsDistributor (just what Earn needs)
const WEEKLY_REWARDS_DISTRIBUTOR_ABI = [
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
  },
  {
    type: "function",
    name: "epochs",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "" }],
    outputs: [
      { type: "bytes32", name: "merkleRoot" },
      { type: "uint256", name: "start" },
      { type: "uint256", name: "end" },
      { type: "uint256", name: "totalFunded" },
    ],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { type: "uint256", name: "" },
      { type: "address", name: "" },
    ],
    outputs: [{ type: "bool", name: "" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "epochId" },
      { type: "uint256", name: "amount" },
      { type: "uint256", name: "generatedLoss" },
      { type: "bytes32[]", name: "proof" },
    ],
    outputs: [],
  },
] as const;

type ClaimBundle = {
  epochId: number;
  amount: string; // uint256 string
  generatedLoss: string; // uint256 string
  proof: string[]; // bytes32[]
};

function isHex32(x: string) {
  return typeof x === "string" && x.startsWith("0x") && x.length === 66;
}

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const ready = mounted;

  // Only show Linea + Base (stable order: Linea then Base)
  const chains = useMemo(() => {
    const filtered = CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any));
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort((a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99));
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(TOKEN_CHAIN_IDS[0]);

  // Mirror wallet network when wallet is on a supported chain
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

  const distributorAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  // IMPORTANT: chain-scoped public client (fixes your build error)
  const publicClient = usePublicClient({ chainId: effectiveChainId });

  const walletNetworkName = useMemo(() => {
    if (!ready || !walletChainId) return "—";
    return CHAIN_LIST.find((c) => c.chainId === walletChainId)?.name ?? String(walletChainId);
  }, [ready, walletChainId]);

  const wrongWalletForSelected = useMemo(() => {
    if (!ready || !isConnected) return false;
    if (!effectiveChainId || !walletChainId) return false;
    return walletChainId !== effectiveChainId;
  }, [ready, isConnected, walletChainId, effectiveChainId]);

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

  /**
   * ==========================
   * Referral Registry reads
   * ==========================
   */
  const readsEnabled =
    ready &&
    !!effectiveChainId &&
    isConnected &&
    !!address &&
    registryAddress !== zeroAddress &&
    !wrongWalletForSelected; // reads from selected chain; keep strict to avoid confusing state

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

  const { data: myLossTotal, refetch: refetchLoss } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_generated_loss",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  const { data: myRewardsTotal, refetch: refetchRewards } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  /**
   * ==========================
   * Weekly distributor reads
   * ==========================
   */
  const distributorReadsEnabled =
    ready &&
    !!effectiveChainId &&
    isConnected &&
    !!address &&
    distributorAddress !== zeroAddress &&
    !wrongWalletForSelected;

  const { data: currentEpochRaw, refetch: refetchEpoch } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "currentEpoch",
    query: { enabled: distributorReadsEnabled },
  });

  const currentEpoch = useMemo(() => {
    const v = currentEpochRaw as any;
    if (typeof v === "bigint") return v;
    try {
      if (v?.toString) return BigInt(v.toString());
    } catch {}
    return 0n;
  }, [currentEpochRaw]);

  const { data: epochMetaRaw } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "epochs",
    args: [currentEpoch],
    query: { enabled: distributorReadsEnabled && currentEpoch > 0n },
  });

  const { data: alreadyClaimedRaw, refetch: refetchClaimed } = useReadContract({
    chainId: effectiveChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "claimed",
    args: [currentEpoch, (address ?? zeroAddress) as `0x${string}`],
    query: { enabled: distributorReadsEnabled && currentEpoch > 0n },
  });

  const alreadyClaimed = Boolean(alreadyClaimedRaw);

  /**
   * ==========================
   * Referral link + status
   * ==========================
   */
  const myCodeHex = (myPublicCode as Hex | undefined) ?? null;
  const haveCode = !!myCodeHex && isHex(myCodeHex) && myCodeHex.length === 66;

  const referralLink = useMemo(() => {
    if (!haveCode) return "";
    return `${SITE_ORIGIN}/play?ref=${myCodeHex}`;
  }, [haveCode, myCodeHex]);

  const isBound =
    (referrerOfMe as string | undefined) && (referrerOfMe as string) !== zeroAddress;

  /**
   * ==========================
   * Weekly claim bundle (GitHub raw)
   * ==========================
   */
  const [bundleStatus, setBundleStatus] = useState<string>("");
  const [bundleErr, setBundleErr] = useState<string>("");
  const [bundle, setBundle] = useState<ClaimBundle | null>(null);

  const amountBig = useMemo(() => {
    if (!bundle?.amount) return 0n;
    try {
      return BigInt(bundle.amount);
    } catch {
      return 0n;
    }
  }, [bundle]);

  const genLossBig = useMemo(() => {
    if (!bundle?.generatedLoss) return 0n;
    try {
      return BigInt(bundle.generatedLoss);
    } catch {
      return 0n;
    }
  }, [bundle]);

  const amountLabel = useMemo(() => {
    // DTC is 18 decimals on both chains
    return fmtNum(Number(formatUnits(amountBig, 18)), 6);
  }, [amountBig]);

  const genLossLabel = useMemo(() => {
    return fmtNum(Number(formatUnits(genLossBig, 18)), 6);
  }, [genLossBig]);

  async function fetchBundle() {
    setBundleErr("");
    setBundle(null);

    if (!ready || !effectiveChainId || !address) {
      setBundleStatus("Connect wallet to load your weekly bundle.");
      return;
    }
    if (wrongWalletForSelected) {
      setBundleStatus("Switch wallet network to match the selected chain to load bundle.");
      return;
    }

    const url = claimBundleUrl(effectiveChainId, address);
    setBundleStatus(`Checking GitHub bundle…`);

    try {
      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        setBundleStatus("");
        setBundleErr(`No bundle found yet for this week. (HTTP ${res.status})`);
        return;
      }

      const json = (await res.json()) as ClaimBundle;

      // Minimal validation
      const ok =
        typeof json?.epochId === "number" &&
        typeof json?.amount === "string" &&
        typeof json?.generatedLoss === "string" &&
        Array.isArray(json?.proof) &&
        json.proof.every((p) => isHex32(p));

      if (!ok) {
        setBundleStatus("");
        setBundleErr("Bundle JSON exists but is malformed. Check fields: epochId, amount, generatedLoss, proof[].");
        return;
      }

      setBundle(json);
      setBundleStatus("Bundle loaded ✅");
      window.setTimeout(() => setBundleStatus(""), 1200);
    } catch (e: any) {
      setBundleStatus("");
      setBundleErr(e?.message || "Failed to fetch bundle.");
    }
  }

  // Auto-fetch bundle when chain + address becomes ready
  useEffect(() => {
    if (!ready) return;
    if (!address) return;
    if (!effectiveChainId) return;
    // keep it light; user can press refresh too
    void fetchBundle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, address, effectiveChainId, wrongWalletForSelected]);

  /**
   * ==========================
   * Actions
   * ==========================
   */
  const [status, setStatus] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [copied, setCopied] = useState(false);

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
      setErr("No public client for selected chain.");
      return;
    }
    if (wrongWalletForSelected) {
      setErr(`Switch wallet network to ${selectedChain?.name ?? "selected chain"} first.`);
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

  async function claimWeeklyRewards() {
    setErr("");
    setStatus("");

    if (!ready || !isConnected || !address) {
      setErr("Connect your wallet first.");
      return;
    }
    if (!effectiveChainId || distributorAddress === zeroAddress) {
      setErr("Unsupported chain for weekly claims.");
      return;
    }
    if (!publicClient) {
      setErr("No public client for selected chain.");
      return;
    }
    if (wrongWalletForSelected) {
      setErr(`Switch wallet network to ${selectedChain?.name ?? "selected chain"} first.`);
      return;
    }
    if (!bundle) {
      setErr("No bundle loaded. Click “REFRESH BUNDLE” first.");
      return;
    }
    if (alreadyClaimed) {
      setErr("Already claimed for the current epoch.");
      return;
    }
    if (bundle.epochId <= 0) {
      setErr("Invalid epochId in bundle.");
      return;
    }

    try {
      setStatus("Confirm claim in wallet…");

      const hash = await writeContractAsync({
        chainId: effectiveChainId,
        abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
        address: distributorAddress,
        functionName: "claim",
        args: [BigInt(bundle.epochId), BigInt(bundle.amount), BigInt(bundle.generatedLoss), bundle.proof as any],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Weekly claim successful ✅");
      window.setTimeout(() => setStatus(""), 1500);

      await Promise.allSettled([
        refetchClaimed(),
        refetchEpoch(),
        refetchLoss(),
        refetchRewards(),
      ]);
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
                Referrals are permanent (wallet-bound). Weekly rewards are claimed on-chain from the distributor.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Selected: <span className="text-neutral-100">{selectedChain?.name ?? "—"}</span>
              {ready && isConnected ? (
                <span className="ml-2 text-neutral-500">
                  (wallet: <span className="text-neutral-300">{walletNetworkName}</span>)
                </span>
              ) : null}
            </div>
          </div>

          {/* Network toggle (same style as Home) */}
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

          {/* Weekly claim */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Weekly rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Bundle is fetched from GitHub raw and claimed on-chain via the distributor.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchBundle()}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                  disabled={!ready || !address || !effectiveChainId || wrongWalletForSelected}
                  title={wrongWalletForSelected ? "Switch wallet network to match selected chain" : undefined}
                >
                  REFRESH BUNDLE
                </button>

                <button
                  type="button"
                  onClick={() => void claimWeeklyRewards()}
                  disabled={
                    !ready ||
                    !address ||
                    !effectiveChainId ||
                    wrongWalletForSelected ||
                    distributorAddress === zeroAddress ||
                    !bundle ||
                    alreadyClaimed
                  }
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !ready ||
                    !address ||
                    !effectiveChainId ||
                    wrongWalletForSelected ||
                    distributorAddress === zeroAddress ||
                    !bundle ||
                    alreadyClaimed
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
                <div className="mt-1 font-mono text-sm text-neutral-200">{currentEpoch.toString()}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Bundle amount (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{bundle ? amountLabel : "—"}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Bundle generatedLoss (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{bundle ? genLossLabel : "—"}</div>
              </div>
            </div>

            {epochMetaRaw ? (
              <div className="mt-3 text-[12px] text-neutral-500">
                Epoch window (unix):{" "}
                <span className="font-mono text-neutral-300">
                  {(epochMetaRaw as any)?.[1]?.toString?.() ?? "—"} → {(epochMetaRaw as any)?.[2]?.toString?.() ?? "—"}
                </span>
              </div>
            ) : null}

            {bundleStatus ? (
              <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-200">
                {bundleStatus}
              </div>
            ) : null}

            {bundleErr ? (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
                {bundleErr}
                {ready && effectiveChainId && address ? (
                  <div className="mt-2 text-[11px] text-red-200/80">
                    Expected URL:{" "}
                    <span className="break-all font-mono">
                      {claimBundleUrl(effectiveChainId, address)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {wrongWalletForSelected ? (
              <div className="mt-3 text-[12px] text-amber-200/90">
                You’re viewing <b>{selectedChain?.name ?? "—"}</b>, but your wallet is on <b>{walletNetworkName}</b>.
                Switch wallet network using the toggle above.
              </div>
            ) : null}
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
                  Share this link. Users bind automatically on their first token game.
                </div>
              </div>

              <button
                type="button"
                onClick={() => void registerCode()}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                disabled={!ready || !isConnected || !address || registryAddress === zeroAddress || wrongWalletForSelected}
                title={wrongWalletForSelected ? `Switch wallet to ${selectedChain?.name ?? "selected chain"}` : undefined}
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
                <div className="text-[12px] text-neutral-400">referrer_total_generated_loss</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(myLossTotal as any)?.toString?.() ?? "0"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">referrer_total_rewards</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(myRewardsTotal as any)?.toString?.() ?? "0"}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              Registry totals update as claims are processed. Weekly claims happen via the distributor contract.
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
