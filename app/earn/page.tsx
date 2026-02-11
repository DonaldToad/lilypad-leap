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

// ===== Home-style token-mode chains (Linea + Base)
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

// ===== WeeklyRewardsDistributor minimal ABI (what Earn needs)
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
 * ===== Option C (GitHub raw bundles)
 * Put claim JSON files in a public repo path like:
 *   https://raw.githubusercontent.com/<OWNER>/<REPO>/<BRANCH>/claims/<chainId>/<user>.json
 *
 * Example:
 *   claims/59144/0xabc...def.json
 *   claims/8453/0xabc...def.json
 *
 * JSON format expected:
 * {
 *   "epochId": 12,
 *   "amount": "123000000000000000000",        // uint256 (string ok)
 *   "generatedLoss": "456000000000000000000", // uint256 (string ok)
 *   "proof": ["0x...", "0x...", ...]          // bytes32[]
 * }
 */
const CLAIMS_RAW_BASE =
  "https://raw.githubusercontent.com/DonaldToad/lilypad-leap/main";

type ClaimBundle = {
  epochId: number | string;
  amount: string;
  generatedLoss: string;
  proof: string[];
};

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Only show Linea + Base (stable order)
  const chains = useMemo(() => {
    const filtered = CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any));
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort((a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99));
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(TOKEN_CHAIN_IDS[0]);

  // Mirror wallet network when wallet is on supported chain
  useEffect(() => {
    if (!mounted) return;
    if (isTokenChain(walletChainId)) setSelectedChainId(walletChainId);
  }, [mounted, walletChainId]);

  const selectedChain = useMemo(() => {
    return chains.find((c) => c.chainId === selectedChainId) ?? chains[0];
  }, [chains, selectedChainId]);

  const chainName = selectedChain?.name ?? String(selectedChainId);

  // IMPORTANT: chain-scoped client (so we never pass chainId into readContract calls)
  const publicClient = usePublicClient({ chainId: selectedChainId });

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
    if (!mounted || !isConnected) return false;
    if (!walletChainId) return false;
    return walletChainId !== selectedChainId;
  }, [mounted, isConnected, walletChainId, selectedChainId]);

  const readsEnabled =
    mounted &&
    isConnected &&
    !!address &&
    registryAddress !== zeroAddress;

  // ===== Referral registry reads
  const { data: referrerOfMe } = useReadContract({
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

  const { data: totalRewardsRaw, refetch: refetchRewardsTotal } = useReadContract({
    chainId: selectedChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled },
  });

  // ===== Distributor read (optional, helps UX)
  const { data: currentEpochRaw } = useReadContract({
    chainId: selectedChainId,
    abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
    address: distributorAddress,
    functionName: "currentEpoch",
    args: [],
    query: { enabled: mounted && distributorAddress !== zeroAddress },
  });

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
    (referrerOfMe as string | undefined) &&
    (referrerOfMe as string) !== zeroAddress;

  async function onPickChain(chainId: number) {
    setErr("");
    setStatus("");
    setSelectedChainId(chainId);

    // Same behavior as home: switch wallet if connected
    if (!mounted) return;
    if (!isConnected) return;

    try {
      await switchChainAsync?.({ chainId });
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || "Network switch failed.");
    }
  }

  async function registerCode() {
    setErr("");
    setStatus("");

    if (!mounted || !isConnected || !address) return setErr("Connect your wallet first.");
    if (registryAddress === zeroAddress) return setErr("Registry not deployed on this chain.");
    if (!publicClient) return setErr("No public client.");
    if (wrongWalletForSelected) return setErr(`Switch wallet network to ${chainName} first.`);

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

      await Promise.allSettled([refetchMyCode(), refetchLoss(), refetchRewardsTotal()]);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Register failed.");
    }
  }

  // ===== Rewards claim bundle (GitHub raw)
  const [bundle, setBundle] = useState<ClaimBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);

  const bundleUrl = useMemo(() => {
    if (!address) return "";
    return `${CLAIMS_RAW_BASE}/claims/${selectedChainId}/${address.toLowerCase()}.json`;
  }, [address, selectedChainId]);

  const epochLabel = useMemo(() => {
    const v: any = currentEpochRaw;
    if (typeof v === "bigint") return v.toString();
    if (v?.toString) return v.toString();
    return "—";
  }, [currentEpochRaw]);

  const pendingLabel = useMemo(() => {
    if (!bundle) return "—";
    try {
      // assuming 18 decimals (DTC)
      const asToken = Number(formatUnits(BigInt(bundle.amount), 18));
      return `${fmtNum(asToken, 6)} DTC`;
    } catch {
      return bundle.amount;
    }
  }, [bundle]);

  async function loadClaimBundle() {
    setErr("");
    setStatus("");
    setBundle(null);

    if (!address) return setErr("Connect your wallet to load your claim bundle.");
    if (!bundleUrl) return setErr("Missing bundle URL.");
    setBundleLoading(true);

    try {
      const res = await fetch(bundleUrl, { cache: "no-store" });
      if (!res.ok) {
        setBundleLoading(false);
        return setErr(
          `No claim bundle found yet for this wallet on ${chainName}. (HTTP ${res.status})`
        );
      }
      const j = (await res.json()) as ClaimBundle;

      if (!j || !j.proof || !Array.isArray(j.proof)) {
        setBundleLoading(false);
        return setErr("Bundle JSON invalid (missing proof array).");
      }

      setBundle(j);
      setBundleLoading(false);
      setStatus("Claim bundle loaded ✅");
      window.setTimeout(() => setStatus(""), 1200);
    } catch (e: any) {
      setBundleLoading(false);
      setErr(e?.message || "Failed to load bundle.");
    }
  }

  async function claimRewards() {
    setErr("");
    setStatus("");

    if (!mounted || !isConnected || !address) return setErr("Connect your wallet first.");
    if (!publicClient) return setErr("No public client.");
    if (wrongWalletForSelected) return setErr(`Switch wallet network to ${chainName} first.`);
    if (distributorAddress === zeroAddress) return setErr("Distributor not deployed on this chain.");
    if (!bundle) return setErr("Load your claim bundle first.");

    try {
      setStatus("Confirm claim in wallet…");

      const epochId = BigInt(bundle.epochId);
      const amount = BigInt(bundle.amount);
      const generatedLoss = BigInt(bundle.generatedLoss);
      const proof = bundle.proof as readonly `0x${string}`[];

      const hash = await writeContractAsync({
        chainId: selectedChainId,
        abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
        address: distributorAddress,
        functionName: "claim",
        args: [epochId, amount, generatedLoss, proof],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Rewards claimed ✅");
      window.setTimeout(() => setStatus(""), 1400);

      // refresh totals
      await Promise.allSettled([refetchLoss(), refetchRewardsTotal()]);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Claim failed.");
    }
  }

  const canClaim =
    mounted &&
    isConnected &&
    !!address &&
    !wrongWalletForSelected &&
    distributorAddress !== zeroAddress &&
    !!bundle;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Earn</h1>
              <p className="mt-2 text-neutral-300">
                Referrals are wallet-bound. Rewards are claimable per chain once your weekly bundle is published.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Network: <span className="text-neutral-100">{chainName}</span>
            </div>
          </div>

          {/* Home-style chain toggle */}
          <div className="mt-6">
            <div className="flex w-full gap-2 rounded-2xl border border-neutral-800 bg-neutral-950 p-2">
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

            {!mounted ? (
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
                  <span className="ml-2 text-amber-200">↳ switch wallet to claim/register</span>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-neutral-600">
                Not connected. Connect wallet to register / claim.
              </div>
            )}
          </div>

          {/* Wallet */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 text-sm text-neutral-300">
              {mounted && isConnected && address ? `Connected: ${truncateAddr(address)}` : "Not connected"}
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

          {/* 💰Rewards */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Current epoch: <span className="font-mono text-neutral-300">{epochLabel}</span> • Bundles live at{" "}
                  <span className="font-mono text-neutral-300">/claims/{selectedChainId}/&lt;wallet&gt;.json</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadClaimBundle()}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    bundleLoading
                      ? "cursor-wait border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  {bundleLoading ? "LOADING…" : "LOAD BUNDLE"}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const txt = bundleUrl || "";
                    if (!txt) return;
                    const ok = await copyText(txt);
                    if (ok) {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 900);
                    }
                  }}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                >
                  {copied ? "COPIED" : "COPY URL"}
                </button>

                <button
                  type="button"
                  onClick={() => void claimRewards()}
                  disabled={!canClaim}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !canClaim
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                  ].join(" ")}
                >
                  CLAIM
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Pending (from bundle)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{pendingLabel}</div>
                <div className="mt-1 text-[11px] text-neutral-500 break-all">
                  {bundle ? `epochId=${bundle.epochId} • generatedLoss=${bundle.generatedLoss}` : "Load bundle to view details."}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Bundle URL</div>
                <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">{bundleUrl || "—"}</div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              If “LOAD BUNDLE” says not found, it means this wallet has no published weekly claim yet on this chain.
            </div>
          </div>

          {/* Your referrer */}
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

          {/* Referral link */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Your referral link</div>
                <div className="mt-1 text-[12px] text-neutral-500">Share this link. Users will bind automatically on their first token game.</div>
              </div>

              <button
                type="button"
                onClick={() => void registerCode()}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                disabled={!mounted || !isConnected || registryAddress === zeroAddress || wrongWalletForSelected}
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
                <div className="text-[12px] text-neutral-400">Total rewards</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(totalRewardsRaw as any)?.toString?.() ?? "0"}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              “Frens won” is not shown because your ReferralRegistry ABI currently doesn’t include it.
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
