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
 * GitHub RAW bundle URL
 * ==========================
 * https://raw.githubusercontent.com/<OWNER>/<REPO>/<BRANCH>/claims/<chainId>/<user>.json
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

function Pill({
  tone,
  children,
}: {
  tone: "neutral" | "good" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/20"
        : tone === "bad"
          ? "bg-red-500/10 text-red-200 ring-1 ring-red-500/20"
          : "bg-neutral-800/40 text-neutral-200 ring-1 ring-neutral-700/60";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
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
    const filtered = CHAIN_LIST.filter((c) =>
      TOKEN_CHAIN_IDS.includes(c.chainId as any),
    );
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort(
      (a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99),
    );
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(
    TOKEN_CHAIN_IDS[0],
  );

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
    return (REF_REGISTRY_BY_CHAIN[effectiveChainId] ??
      zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const distributorAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN[effectiveChainId] ??
      zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  // IMPORTANT: chain-scoped public client
  const publicClient = usePublicClient({ chainId: effectiveChainId });

  const walletNetworkName = useMemo(() => {
    if (!ready || !walletChainId) return "—";
    return (
      CHAIN_LIST.find((c) => c.chainId === walletChainId)?.name ??
      String(walletChainId)
    );
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
    !wrongWalletForSelected;

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
    (referrerOfMe as string | undefined) &&
    (referrerOfMe as string) !== zeroAddress;

  /**
   * ==========================
   * Weekly claim bundle (GitHub raw)
   * ==========================
   */
  const [bundleStatus, setBundleStatus] = useState<string>("");
  const [bundleErr, setBundleErr] = useState<string>("");
  const [bundle, setBundle] = useState<ClaimBundle | null>(null);

  // NEW: explicit loading + "checked" state so CLAIM isn't shown as active by default
  const [bundleLoading, setBundleLoading] = useState<boolean>(false);
  const [bundleChecked, setBundleChecked] = useState<boolean>(false);
  const [bundleNotFound, setBundleNotFound] = useState<boolean>(false); // 404 = "nothing to claim" for this wallet/epoch

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
    return fmtNum(Number(formatUnits(amountBig, 18)), 6);
  }, [amountBig]);

  const genLossLabel = useMemo(() => {
    return fmtNum(Number(formatUnits(genLossBig, 18)), 6);
  }, [genLossBig]);

  const nothingToClaim = useMemo(() => {
    if (!ready) return false;
    if (!bundleChecked) return false;
    if (!isConnected || !address) return false;
    if (!effectiveChainId) return false;
    if (wrongWalletForSelected) return false;
    if (alreadyClaimed) return false;
    // If bundle missing (404) => nothing to claim (for this wallet on this chain for current epoch)
    if (bundleNotFound) return true;
    // If bundle exists but amount is 0 => nothing to claim
    if (bundle && amountBig === 0n) return true;
    return false;
  }, [
    ready,
    bundleChecked,
    isConnected,
    address,
    effectiveChainId,
    wrongWalletForSelected,
    alreadyClaimed,
    bundleNotFound,
    bundle,
    amountBig,
  ]);

  const claimable = useMemo(() => {
    if (!ready) return false;
    if (!bundleChecked) return false;
    if (!isConnected || !address) return false;
    if (!effectiveChainId) return false;
    if (wrongWalletForSelected) return false;
    if (distributorAddress === zeroAddress) return false;
    if (!bundle) return false;
    if (alreadyClaimed) return false;
    if (bundle.epochId <= 0) return false;
    if (amountBig <= 0n) return false;
    return true;
  }, [
    ready,
    bundleChecked,
    isConnected,
    address,
    effectiveChainId,
    wrongWalletForSelected,
    distributorAddress,
    bundle,
    alreadyClaimed,
    amountBig,
  ]);

  const baseDisabledReason = useMemo(() => {
    if (!ready) return "Initializing…";
    if (!isConnected || !address) return "Connect wallet";
    if (!effectiveChainId) return "Select chain";
    if (wrongWalletForSelected) return "Switch wallet network";
    if (distributorAddress === zeroAddress) return "Distributor not set";
    return "";
  }, [
    ready,
    isConnected,
    address,
    effectiveChainId,
    wrongWalletForSelected,
    distributorAddress,
  ]);

  async function fetchBundle() {
    setBundleErr("");
    setBundle(null);
    setBundleNotFound(false);
    setBundleChecked(false);
    setBundleLoading(true);

    if (!ready || !effectiveChainId || !address) {
      setBundleStatus("Connect wallet to load your weekly bundle.");
      setBundleLoading(false);
      setBundleChecked(true);
      return;
    }
    if (wrongWalletForSelected) {
      setBundleStatus(
        "Switch wallet network to match the selected chain to load bundle.",
      );
      setBundleLoading(false);
      setBundleChecked(true);
      return;
    }

    const url = claimBundleUrl(effectiveChainId, address);
    setBundleStatus(`Checking GitHub bundle…`);

    try {
      const res = await fetch(url, { cache: "no-store" });

      // Treat 404 (and generally non-OK) as "no bundle / nothing to claim"
      if (!res.ok) {
        setBundleStatus("");
        setBundleNotFound(true);
        setBundleChecked(true);
        setBundleLoading(false);

        // Keep it non-scary: 404 isn't an "error" UX-wise, it's just no rewards.
        if (res.status !== 404) {
          setBundleErr(`Bundle not available. (HTTP ${res.status})`);
        } else {
          setBundleErr(""); // no red error box for 404
        }
        return;
      }

      const json = (await res.json()) as ClaimBundle;

      const ok =
        typeof json?.epochId === "number" &&
        typeof json?.amount === "string" &&
        typeof json?.generatedLoss === "string" &&
        Array.isArray(json?.proof) &&
        json.proof.every((p) => isHex32(p));

      if (!ok) {
        setBundleStatus("");
        setBundleErr(
          "Bundle JSON exists but is malformed. Check fields: epochId, amount, generatedLoss, proof[].",
        );
        setBundleChecked(true);
        setBundleLoading(false);
        return;
      }

      setBundle(json);
      setBundleStatus("Bundle loaded ✅");
      window.setTimeout(() => setBundleStatus(""), 1200);

      setBundleChecked(true);
      setBundleLoading(false);
    } catch (e: any) {
      setBundleStatus("");
      setBundleErr(e?.message || "Failed to fetch bundle.");
      setBundleChecked(true);
      setBundleLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    if (!address) return;
    if (!effectiveChainId) return;

    // Reset states before auto-fetch so button isn't "CLAIM" by default
    setBundle(null);
    setBundleErr("");
    setBundleStatus("");
    setBundleNotFound(false);
    setBundleChecked(false);
    setBundleLoading(false);

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
      setErr(
        `Switch wallet network to ${selectedChain?.name ?? "selected chain"} first.`,
      );
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

      await Promise.allSettled([
        refetchMyCode(),
        refetchLoss(),
        refetchRewards(),
        refetchReferrer(),
      ]);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Register failed.");
    }
  }

  async function claimWeeklyRewards() {
    setErr("");
    setStatus("");

    if (!claimable) {
      // friendly guard; UI should already prevent click
      if (nothingToClaim) {
        setErr(
          "Nothing to claim this week. Share your referral link and invite friends to play to start earning.",
        );
      } else if (bundleLoading || !bundleChecked) {
        setErr("Still loading your weekly bundle. Try again in a moment.");
      } else if (baseDisabledReason) {
        setErr(baseDisabledReason);
      } else {
        setErr("Claim not available.");
      }
      return;
    }

    if (!publicClient) {
      setErr("No public client for selected chain.");
      return;
    }
    if (!bundle) {
      setErr("No bundle loaded. Click “REFRESH BUNDLE” first.");
      return;
    }

    try {
      setStatus("Confirm claim in wallet…");

      const hash = await writeContractAsync({
        chainId: effectiveChainId!,
        abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
        address: distributorAddress,
        functionName: "claim",
        args: [
          BigInt(bundle.epochId),
          BigInt(bundle.amount),
          BigInt(bundle.generatedLoss),
          bundle.proof as any,
        ],
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

  const howWorksText = (
    <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-neutral-100">
          How referrals + weekly rewards work
        </div>
        <Pill tone="good">10% weekly</Pill>
      </div>

      <div className="mt-2 text-[12px] text-neutral-400">
        You earn <b className="text-neutral-200">10%</b> of your referees’{" "}
        <b className="text-neutral-200">net losses</b>, bundled weekly and
        claimable on-chain.
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
          <div className="text-[12px] font-semibold text-neutral-200">
            1) Share your link
          </div>
          <div className="mt-1 text-[12px] text-neutral-500">
            Copy your referral link below and send it to friends.
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
          <div className="text-[12px] font-semibold text-neutral-200">
            2) Auto-register + bind
          </div>
          <div className="mt-1 text-[12px] text-neutral-500">
            A player’s referral binding happens automatically on their{" "}
            <b className="text-neutral-300">first token game</b> after visiting a
            referral link.
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
          <div className="text-[12px] font-semibold text-neutral-200">
            3) Claim weekly
          </div>
          <div className="mt-1 text-[12px] text-neutral-500">
            Every week, a claim bundle is published. Load it and claim on the
            same chain (Linea/Base).
          </div>
        </div>
      </div>

      <div className="mt-3 text-[12px] text-neutral-500">
        Note: If your weekly amount is{" "}
        <b className="text-neutral-300">0</b>, you’ll see “NOTHING TO CLAIM”.
      </div>
    </div>
  );

  // Button rendering logic (keeps UX explicit)
  const claimButton = useMemo(() => {
    // Loading / not checked yet: don't show active CLAIM
    if (!ready || bundleLoading || (!bundleChecked && isConnected && !!address)) {
      const disabled =
        !ready ||
        !!baseDisabledReason ||
        wrongWalletForSelected ||
        !effectiveChainId ||
        !address;
      const title =
        baseDisabledReason ||
        (wrongWalletForSelected ? "Switch wallet network to match selected chain" : "Loading bundle…");

      return (
        <button
          type="button"
          disabled={true}
          title={title}
          className="cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-500"
        >
          LOADING…
        </button>
      );
    }

    if (alreadyClaimed) {
      return (
        <button
          type="button"
          disabled={true}
          className="cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-500"
          title="Already claimed"
        >
          CLAIMED
        </button>
      );
    }

    if (nothingToClaim) {
      return (
        <button
          type="button"
          disabled={true}
          className="cursor-not-allowed rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-extrabold text-red-200"
          title="Nothing to claim this week"
        >
          NOTHING TO CLAIM
        </button>
      );
    }

    const disabled = !claimable;
    const title =
      baseDisabledReason ||
      (disabled ? "Claim not available" : "Claim weekly rewards");

    return (
      <button
        type="button"
        onClick={() => void claimWeeklyRewards()}
        disabled={disabled}
        title={title || undefined}
        className={[
          "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
          disabled
            ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
        ].join(" ")}
      >
        CLAIM
      </button>
    );
  }, [
    ready,
    bundleLoading,
    bundleChecked,
    isConnected,
    address,
    baseDisabledReason,
    wrongWalletForSelected,
    effectiveChainId,
    alreadyClaimed,
    nothingToClaim,
    claimable,
  ]);

  const nothingToClaimHelper =
    nothingToClaim && ready && isConnected && !wrongWalletForSelected ? (
      <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
        You didn’t earn referral rewards this week.
        <div className="mt-1 text-[11px] text-red-200/80">
          Share your referral link, invite friends to play, and start earning{" "}
          <b>10% weekly</b> from your referees’ net losses.
        </div>
      </div>
    ) : null;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Earn</h1>
              <p className="mt-2 text-neutral-300">
                Earn weekly referral rewards on Linea + Base.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
              <span>
                Selected:{" "}
                <span className="text-neutral-100">
                  {selectedChain?.name ?? "—"}
                </span>
              </span>
              {ready && isConnected ? (
                <span className="text-neutral-500">
                  (wallet:{" "}
                  <span className="text-neutral-300">{walletNetworkName}</span>)
                </span>
              ) : null}

              {!ready ? <Pill tone="neutral">Initializing</Pill> : null}
              {ready && !isConnected ? <Pill tone="warn">Not connected</Pill> : null}
              {ready && isConnected && wrongWalletForSelected ? (
                <Pill tone="warn">Wrong network</Pill>
              ) : null}
              {ready && isConnected && !wrongWalletForSelected ? (
                <Pill tone="good">Ready</Pill>
              ) : null}
            </div>
          </div>

          {/* HOW IT WORKS */}
          {howWorksText}

          {/* Network toggle */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-sm font-semibold text-neutral-100">
                  Network
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  Selected:{" "}
                  <span className="font-semibold text-neutral-200">
                    {selectedChain?.name ?? "—"}
                  </span>
                </div>
              </div>

              <div className="w-full">
                <div className="flex w-full gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-2">
                  {chains.map((c) => {
                    const active = c.chainId === selectedChainId;

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
                              <div className="text-sm font-semibold text-neutral-50">
                                {c.name}
                              </div>
                              {active ? (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
                                  LIVE
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-[11px] text-neutral-400">
                              Chain ID: {c.chainId}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {switchStatus ? (
                  <div className="mt-2 text-[11px] text-amber-200">
                    {switchStatus}
                  </div>
                ) : null}

                {!ready ? (
                  <div className="mt-2 text-[11px] text-neutral-600">
                    Initializing…
                  </div>
                ) : isConnected ? (
                  <div className="mt-2 text-[11px] text-neutral-600">
                    Wallet network:{" "}
                    <span className="text-neutral-300">
                      {isTokenChain(walletChainId)
                        ? chains.find((c) => c.chainId === walletChainId)?.name ??
                          walletChainId
                        : walletChainId ?? "—"}
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-neutral-600">
                    Not connected. The toggle will switch your wallet network
                    after you connect.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Wallet card */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
              {ready && isConnected && address
                ? `Connected: ${truncateAddr(address)}`
                : "Not connected"}
              {ready && isConnected && address ? (
                <Pill tone="good">Connected</Pill>
              ) : (
                <Pill tone="warn">Connect</Pill>
              )}
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

            {ready && isConnected && wrongWalletForSelected ? (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-200">
                You’re viewing <b>{selectedChain?.name ?? "—"}</b>, but your
                wallet is on <b>{walletNetworkName}</b>. Switch wallet network
                using the toggle above.
              </div>
            ) : null}
          </div>

          {/* Weekly claim */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">
                  💰 Weekly rewards
                </div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Load your claim bundle (GitHub) then claim on-chain.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchBundle()}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                  disabled={
                    !ready ||
                    !address ||
                    !effectiveChainId ||
                    wrongWalletForSelected ||
                    bundleLoading
                  }
                  title={
                    wrongWalletForSelected
                      ? "Switch wallet network to match selected chain"
                      : bundleLoading
                        ? "Loading bundle…"
                        : undefined
                  }
                >
                  {bundleLoading ? "REFRESHING…" : "REFRESH BUNDLE"}
                </button>

                {claimButton}
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Current epoch</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {currentEpoch.toString()}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">
                  Bundle amount (DTC)
                </div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {bundleChecked ? (bundle ? amountLabel : "0") : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">
                  Bundle net loss basis (DTC)
                </div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {bundleChecked ? (bundle ? genLossLabel : "0") : "—"}
                </div>
              </div>
            </div>

            {epochMetaRaw ? (
              <div className="mt-3 text-[12px] text-neutral-500">
                Epoch window (unix):{" "}
                <span className="font-mono text-neutral-300">
                  {(epochMetaRaw as any)?.[1]?.toString?.() ?? "—"} →{" "}
                  {(epochMetaRaw as any)?.[2]?.toString?.() ?? "—"}
                </span>
              </div>
            ) : null}

            {bundleStatus ? (
              <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-200">
                {bundleStatus}
              </div>
            ) : null}

            {/* Show “nothing to claim” helper */}
            {nothingToClaimHelper}

            {/* Keep bundleErr for non-404 failures or malformed bundle */}
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

            {!bundleChecked && ready && isConnected && !wrongWalletForSelected ? (
              <div className="mt-3 text-[12px] text-neutral-500">
                Loading your weekly bundle…
              </div>
            ) : null}
          </div>

          {/* Referrer binding */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-neutral-100">
                Your referrer
              </div>
              {ready && isConnected && address ? (
                isBound ? (
                  <Pill tone="good">Bound</Pill>
                ) : (
                  <Pill tone="warn">Not bound</Pill>
                )
              ) : (
                <Pill tone="neutral">—</Pill>
              )}
            </div>

            <div className="mt-2 text-sm text-neutral-300">
              {ready && isConnected && address ? (
                isBound ? (
                  <span>
                    Bound to:{" "}
                    <span className="font-mono">
                      {truncateAddr(referrerOfMe as string)}
                    </span>
                  </span>
                ) : (
                  <span className="text-neutral-400">
                    Not bound yet. Binding happens automatically on a player’s
                    first token game after visiting a referral link.
                  </span>
                )
              ) : (
                <span className="text-neutral-400">
                  Connect your wallet to view.
                </span>
              )}
            </div>
          </div>

          {/* My referral link */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">
                  Your referral link
                </div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Your referral code is automatically registered when you play
                  your first token game. Manual registration is optional.
                </div>
              </div>

              <button
                type="button"
                onClick={() => void registerCode()}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                disabled={
                  !ready ||
                  !isConnected ||
                  !address ||
                  registryAddress === zeroAddress ||
                  wrongWalletForSelected
                }
                title={
                  wrongWalletForSelected
                    ? `Switch wallet to ${selectedChain?.name ?? "selected chain"}`
                    : undefined
                }
              >
                {haveCode ? "RE-REGISTER (optional)" : "REGISTER MY CODE (optional)"}
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] text-neutral-400">Code (bytes32)</div>
                {haveCode ? <Pill tone="good">Active</Pill> : <Pill tone="warn">Not created yet</Pill>}
              </div>

              <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                {haveCode ? myCodeHex : "— (will auto-register on first token game)"}
              </div>

              <div className="mt-3 text-[12px] text-neutral-400">Link</div>
              <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                {haveCode ? referralLink : "—"}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
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

                {referralLink ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const text =
                        `🐸 Lilypad Leap referral\n` +
                        `Earn weekly rewards (10% of net losses)\n` +
                        `Use my link: ${referralLink}`;
                      const ok = await copyText(text);
                      if (ok) {
                        setStatus("Share text copied ✅");
                        window.setTimeout(() => setStatus(""), 1200);
                      }
                    }}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                  >
                    COPY SHARE TEXT
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">
              Lifetime totals
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">
                  referrer_total_generated_loss
                </div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(myLossTotal as any)?.toString?.() ?? "0"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">
                  referrer_total_rewards
                </div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {(myRewardsTotal as any)?.toString?.() ?? "0"}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              Totals update as weekly claims are processed. Weekly rewards ={" "}
              <b className="text-neutral-300">10%</b> of referees’ net losses.
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
