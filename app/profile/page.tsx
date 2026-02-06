"use client";

import TopNav from "../components/TopNav";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import { LILYPAD_VAULT_BY_CHAIN } from "../lib/addresses";
import { LILYPAD_VAULT_ABI } from "../lib/abi/lilypadVault";
import { zeroAddress } from "viem";
import { useMemo } from "react";

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const allowed = chainId === 59144 || chainId === 8453;
  const effectiveChainId = allowed ? chainId : PRIMARY_CHAIN.chainId;

  const vaultAddress = (LILYPAD_VAULT_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;

  const { data: gamesLen } = useReadContract({
    abi: LILYPAD_VAULT_ABI,
    address: vaultAddress,
    functionName: "getUserGamesLength",
    args: address ? [address] : [zeroAddress],
    query: { enabled: isConnected && !!address && vaultAddress !== zeroAddress },
  });

  const { data: owedWei } = useReadContract({
    abi: LILYPAD_VAULT_ABI,
    address: vaultAddress,
    functionName: "owed",
    args: address ? [address] : [zeroAddress],
    query: { enabled: isConnected && !!address && vaultAddress !== zeroAddress },
  });

  const owedDtc = useMemo(() => {
    const v = owedWei ?? 0n;
    return Number(v / 10n ** 18n);
  }, [owedWei]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <h1 className="text-2xl font-bold">Profile</h1>
          <p className="mt-2 text-neutral-300">
            Demo Mode is always available. Token Mode stats appear when your wallet is connected on Linea or Base.
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm text-neutral-400">Total Games</div>
              <div className="mt-1 text-xl font-semibold">
                {isConnected ? String(gamesLen ?? "—") : "—"}
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm text-neutral-400">Owed (claimable)</div>
              <div className="mt-1 text-xl font-semibold">
                {isConnected ? `${owedDtc} DTC` : "—"}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm text-neutral-400">Active Network</div>
            <div className="mt-1 text-sm text-neutral-200">
              {CHAIN_LIST.find((c) => c.chainId === effectiveChainId)?.name ?? "Unknown"}
              {!allowed && isConnected ? " (unsupported chain: switch to Linea/Base)" : ""}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
