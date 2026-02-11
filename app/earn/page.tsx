"use client";

import TopNav from "../components/TopNav";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { zeroAddress, type Hex, isHex } from "viem";

import { CHAIN_LIST } from "../lib/chains";
import { REFERRAL_REGISTRY_ABI } from "../lib/abi/referralRegistry";
import { REF_REGISTRY_BY_CHAIN } from "../lib/addresses";

const SITE_ORIGIN = "https://hop.donaldtoad.com";

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

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const effectiveChainId = mounted ? chainId : undefined;
  const chainName = useMemo(() => {
    if (!effectiveChainId) return "—";
    return CHAIN_LIST.find((c) => c.chainId === effectiveChainId)?.name ?? String(effectiveChainId);
  }, [effectiveChainId]);

  const registryAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (REF_REGISTRY_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  // Reads
  const { data: referrerOfMe, refetch: refetchReferrer } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrerOf",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: mounted && !!effectiveChainId && isConnected && !!address && registryAddress !== zeroAddress },
  });

  const { data: myPublicCode, refetch: refetchMyCode } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "publicCodeOf",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: mounted && !!effectiveChainId && isConnected && !!address && registryAddress !== zeroAddress },
  });

  const { data: myLossTotal, refetch: refetchLoss } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_generated_loss",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: mounted && !!effectiveChainId && isConnected && !!address && registryAddress !== zeroAddress },
  });

  const { data: myRewardsTotal, refetch: refetchRewards } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: mounted && !!effectiveChainId && isConnected && !!address && registryAddress !== zeroAddress },
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

  const isBound = (referrerOfMe as string | undefined) && (referrerOfMe as string) !== zeroAddress;

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

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Earn</h1>
              <p className="mt-2 text-neutral-300">
                Your referrals are permanent (wallet-bound). Rewards are distributed weekly (Sunday 23:59 UTC cutoff)
                and claimable on-chain.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Network: <span className="text-neutral-100">{chainName}</span>
            </div>
          </div>

          {/* Wallet card */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 text-sm text-neutral-300">
              {mounted && isConnected && address ? `Connected: ${truncateAddr(address)}` : "Not connected"}
            </div>

            {mounted && registryAddress !== zeroAddress ? (
              <div className="mt-2 text-[12px] text-neutral-500">
                Registry: <span className="font-mono text-neutral-300">{registryAddress}</span>
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
                  <span className="text-neutral-400">Not bound yet. You’ll auto-bind on your first bet if you visit a referral link.</span>
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
                onClick={registerCode}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                disabled={!mounted || !isConnected || registryAddress === zeroAddress}
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
            <div className="text-sm font-semibold text-neutral-100">Lifetime totals (for leaderboard)</div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">referrer_total_generated_loss</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{(myLossTotal as any)?.toString?.() ?? "0"}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">referrer_total_rewards</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{(myRewardsTotal as any)?.toString?.() ?? "0"}</div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              These update when you publish the weekly Merkle root + users claim.
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
