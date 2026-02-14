// app/earn/page.tsx
"use client";

import TopNav from "../components/TopNav";
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  zeroAddress,
  type Hex,
  isHex,
  formatUnits,
  keccak256,
  toHex,
  decodeEventLog,
} from "viem";

import { CHAIN_LIST } from "../lib/chains";
import { REFERRAL_REGISTRY_ABI } from "../lib/abi/referralRegistry";
import { LILYPAD_LEAP_GAME_ABI } from "../lib/abi/lilypadLeapGame";
import {
  REF_REGISTRY_BY_CHAIN,
  WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN,
  LILYPAD_GAME_BY_CHAIN,
} from "../lib/addresses";

const SITE_ORIGIN = "https://hop.donaldtoad.com";

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

const CLAIMS_GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/DonaldToad/lilypad-leap-claims/main/claims";

function claimBundleUrl(chainId: number, user: string) {
  const u = (user || "").toLowerCase();
  return `${CLAIMS_GITHUB_RAW_BASE}/${chainId}/${u}.json`;
}

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
  amount: string;
  generatedLoss: string;
  proof: string[];
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

const B32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ZERO_B32 = ("0x" + "00".repeat(32)) as Hex;

function isHexAddress(x: string) {
  const s = (x || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isNonZeroBytes32(x?: string | null) {
  if (!x) return false;
  const s = x.toLowerCase();
  return s.startsWith("0x") && s.length === 66 && s !== ZERO_B32;
}

function hexToBytes32(hex: string) {
  const h = hex.toLowerCase();
  if (!h.startsWith("0x") || h.length !== 66) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byte = parseInt(h.slice(2 + i * 2, 4 + i * 2), 16);
    if (!Number.isFinite(byte)) return null;
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array) {
  let s = "0x";
  for (let i = 0; i < bytes.length; i++)
    s += bytes[i].toString(16).padStart(2, "0");
  return s as Hex;
}

function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      const idx = (value >>> (bits - 5)) & 31;
      output += B32_ALPHABET[idx];
      bits -= 5;
    }
  }
  if (bits > 0) {
    const idx = (value << (5 - bits)) & 31;
    output += B32_ALPHABET[idx];
  }
  return output;
}

function base32DecodeToBytes32(code: string) {
  const cleaned = (code || "")
    .toUpperCase()
    .replace(/^TOAD[-\s]*/i, "")
    .replace(/[-\s]/g, "");

  if (!cleaned) return null;

  const map: Record<string, number> = {};
  for (let i = 0; i < B32_ALPHABET.length; i++) map[B32_ALPHABET[i]] = i;
  map["O"] = map["0"];
  map["I"] = map["1"];
  map["L"] = map["1"];

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const v = map[ch];
    if (v === undefined) return null;
    value = (value << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const u8 = new Uint8Array(bytes);
  if (u8.length === 32) return u8;
  if (u8.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(u8, 32 - u8.length);
    return padded;
  }
  return u8.slice(u8.length - 32);
}

function formatCodeGroups(code: string) {
  const cleaned = code.replace(/[-\s]/g, "");
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += 4)
    parts.push(cleaned.slice(i, i + 4));
  return parts.join("-");
}

function parseReferralCodeToHex32(input: string) {
  const raw = (input || "").trim();
  if (!raw) return null;
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    if (raw.length === 66 && isHex(raw)) return raw as Hex;
    return null;
  }
  const bytes = base32DecodeToBytes32(raw);
  if (!bytes) return null;
  return bytesToHex(bytes);
}

async function tryReadContract<T>(params: {
  publicClient: any;
  address: `0x${string}`;
  abi: any;
  functionName: string;
  args: any[];
}): Promise<T | null> {
  try {
    const v = await params.publicClient.readContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
    });
    return v as T;
  } catch {
    return null;
  }
}

function bi(v: any) {
  if (typeof v === "bigint") return v;
  if (v?.toString) {
    try {
      return BigInt(v.toString());
    } catch {}
  }
  return null;
}

function prettyDtc(v: bigint | null | undefined) {
  if (typeof v !== "bigint") return "0";
  return fmtNum(Number(formatUnits(v, 18)), 6);
}

/**
 * Registry ABI is v1 (bindings + optional totals written by rewardsWriter).
 * Your LilypadLeapGame.sol (uploaded) does NOT call addTotals(), so these totals
 * will remain 0 unless you add an off-chain writer or update the game to write.
 */
const FN_ABI: Record<
  string,
  {
    type: "function";
    name: string;
    stateMutability: "view";
    inputs: any[];
    outputs: any[];
  }
> = {
  referrerOf: {
    type: "function",
    name: "referrerOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "address", name: "" }],
  },
  publicCodeOf: {
    type: "function",
    name: "publicCodeOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "bytes32", name: "" }],
  },
  resolveReferrer: {
    type: "function",
    name: "resolveReferrer",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "" }],
    outputs: [{ type: "address", name: "" }],
  },
  referrer_total_generated_loss: {
    type: "function",
    name: "referrer_total_generated_loss",
    stateMutability: "view",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "uint256", name: "" }],
  },
  referrer_total_rewards: {
    type: "function",
    name: "referrer_total_rewards",
    stateMutability: "view",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "uint256", name: "" }],
  },
  referrer_referees_count: {
    type: "function",
    name: "referrer_referees_count",
    stateMutability: "view",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "uint256", name: "" }],
  },
  referrer_referees: {
    type: "function",
    name: "referrer_referees",
    stateMutability: "view",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "address[]", name: "" }],
  },
  referrer_referee_at: {
    type: "function",
    name: "referrer_referee_at",
    stateMutability: "view",
    inputs: [{ type: "address", name: "" }, { type: "uint256", name: "" }],
    outputs: [{ type: "address", name: "" }],
  },
};

function abiFor(fn: string) {
  const f = FN_ABI[fn];
  return f ? [f] : [];
}

/**
 * COST-FREE weekly stats source:
 * - We compute “this week” from on-chain game logs inside the distributor epoch window.
 * - No server, no paid indexer. We cache results in localStorage per (chainId, epochId, referrer).
 *
 * IMPORTANT: this can be heavy if the epoch is huge + you have many referees.
 * We therefore:
 *  - default to a limited number of referees
 *  - allow manual refresh
 *  - cache aggressively
 */
const GAME_EVENT_CREATED = {
  type: "event",
  name: "GameCreated",
  inputs: [
    { indexed: true, name: "gameId", type: "bytes32" },
    { indexed: true, name: "player", type: "address" },
    { indexed: false, name: "amountReceived", type: "uint256" },
    { indexed: false, name: "mode", type: "uint8" },
    { indexed: false, name: "userCommit", type: "bytes32" },
    { indexed: false, name: "randAnchor", type: "bytes32" },
    { indexed: false, name: "createdAt", type: "uint256" },
    { indexed: false, name: "deadline", type: "uint256" },
    { indexed: false, name: "maxPayoutReserved", type: "uint256" },
  ],
} as const;

const GAME_EVENT_SETTLED = {
  type: "event",
  name: "GameSettled",
  inputs: [
    { indexed: true, name: "gameId", type: "bytes32" },
    { indexed: true, name: "player", type: "address" },
    { indexed: false, name: "won", type: "bool" },
    { indexed: false, name: "cashoutHop", type: "uint8" },
    { indexed: false, name: "payout", type: "uint256" },
    { indexed: false, name: "userCommitHash", type: "bytes32" },
    { indexed: false, name: "randAnchor", type: "bytes32" },
  ],
} as const;

const TOPIC_GAME_CREATED = keccak256(
  toHex(
    "GameCreated(bytes32,address,uint256,uint8,bytes32,bytes32,uint256,uint256,uint256)",
  ),
) as `0x${string}`;

const TOPIC_GAME_SETTLED = keccak256(
  toHex("GameSettled(bytes32,address,bool,uint8,uint256,bytes32,bytes32)"),
) as `0x${string}`;

function padTopicAddress(addr: string) {
  const a = (addr || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(a)) return null;
  return ("0x" + "0".repeat(24 * 2) + a.slice(2)) as `0x${string}`;
}

type WeeklyRefStats = {
  chainId: number;
  epochId: number;
  start: number; // unix
  end: number; // unix
  refereesCount: number;

  // “volume” = sum(amountReceived) across all referee-created games inside epoch window
  volume: string; // bigint string
  wins: string; // sum(max(payout - amountReceived, 0))
  losses: string; // sum(max(amountReceived - payout, 0))

  // “net” = wins - losses (mostly negative in expectation)
  net: string;

  computedAt: string;
};

function safeLower(x?: string) {
  return (x || "").toLowerCase();
}

function lsKeyWeekly(chainId: number, epochId: number, me: string) {
  return `toad:earn:weekly:${chainId}:${epochId}:${safeLower(me)}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function EarnPage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted;

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

  useEffect(() => {
    if (!ready) return;
    if (isTokenChain(walletChainId)) setSelectedChainId(walletChainId);
  }, [ready, walletChainId]);

  const selectedChain = useMemo(
    () => chains.find((c) => c.chainId === selectedChainId) ?? chains[0],
    [chains, selectedChainId],
  );

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

  const gameAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (LILYPAD_GAME_BY_CHAIN[effectiveChainId] ??
      zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

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

  const readsEnabled =
    ready &&
    !!effectiveChainId &&
    isConnected &&
    !!address &&
    registryAddress !== zeroAddress &&
    !wrongWalletForSelected &&
    !!publicClient;

  const [referrerOfMe, setReferrerOfMe] = useState<string>(zeroAddress);
  const [myPublicCode, setMyPublicCode] = useState<Hex | null>(null);
  const [myLossTotal, setMyLossTotal] = useState<bigint | null>(null);
  const [myRewardsTotal, setMyRewardsTotal] = useState<bigint | null>(null);

  const readAny = useCallback(
    async (fnList: string[], args: any[]) => {
      if (!readsEnabled || !publicClient) return null;
      const pc = publicClient as any;
      const addr = registryAddress as `0x${string}`;
      for (const fn of fnList) {
        const v = await tryReadContract<any>({
          publicClient: pc,
          address: addr,
          abi: abiFor(fn),
          functionName: fn,
          args,
        });
        if (v !== null && v !== undefined) return v;
      }
      return null;
    },
    [readsEnabled, publicClient, registryAddress],
  );

  const refreshCore = useCallback(async () => {
    if (!readsEnabled || !address) return;
    const me = address as `0x${string}`;

    const refV = await readAny(["referrerOf"], [me]);
    if (typeof refV === "string") setReferrerOfMe(refV);

    const codeV = await readAny(["publicCodeOf"], [me]);
    if (typeof codeV === "string" && isHex(codeV) && codeV.length === 66)
      setMyPublicCode(codeV as Hex);

    // These are OPTIONAL totals in your registry (only update if someone calls addTotals as rewardsWriter).
    const lossV = await readAny(["referrer_total_generated_loss"], [me]);
    setMyLossTotal(bi(lossV) ?? 0n);

    const rewardsV = await readAny(["referrer_total_rewards"], [me]);
    setMyRewardsTotal(bi(rewardsV) ?? 0n);
  }, [readsEnabled, address, readAny]);

  // ----- Referees list (best-effort) -----
  const [refsCount, setRefsCount] = useState<number>(0);
  const [refsList, setRefsList] = useState<string[]>([]);
  const [refsOpen, setRefsOpen] = useState<boolean>(false);
  const [refsLoading, setRefsLoading] = useState<boolean>(false);
  const [refsError, setRefsError] = useState<string>("");

  const loadReferees = useCallback(
    async (limit: number) => {
      setRefsError("");
      setRefsLoading(true);

      if (!readsEnabled || !address || !effectiveChainId || !publicClient) {
        setRefsLoading(false);
        return;
      }

      const me = address as `0x${string}`;
      const pc = publicClient as any;
      const reg = registryAddress as `0x${string}`;

      const countV = await tryReadContract<any>({
        publicClient: pc,
        address: reg,
        abi: abiFor("referrer_referees_count"),
        functionName: "referrer_referees_count",
        args: [me],
      });

      const countNum = bi(countV) ? Number(bi(countV)!) : 0;
      const target = Math.min(Math.max(0, limit), Math.max(0, countNum));

      let list: string[] = [];

      // Try array getter (if your deployed registry doesn’t implement it, it will return null)
      const arrV = await tryReadContract<any>({
        publicClient: pc,
        address: reg,
        abi: abiFor("referrer_referees"),
        functionName: "referrer_referees",
        args: [me],
      });

      if (Array.isArray(arrV)) {
        list = arrV
          .map((x: any) => String(x))
          .filter((x: string) => isHexAddress(x) && x !== zeroAddress);
      } else if (countNum > 0) {
        // Fallback: index getter
        const out: string[] = [];
        for (let i = 0; i < target; i++) {
          const v = await tryReadContract<any>({
            publicClient: pc,
            address: reg,
            abi: abiFor("referrer_referee_at"),
            functionName: "referrer_referee_at",
            args: [me, BigInt(i)],
          });
          if (typeof v === "string" && isHexAddress(v) && v !== zeroAddress)
            out.push(v);
          else break;
        }
        list = out;
      }

      const uniq = Array.from(new Set(list.map((x) => x.toLowerCase())));
      setRefsCount(countNum > 0 ? countNum : uniq.length);
      setRefsList(uniq.slice(0, refsOpen ? uniq.length : Math.max(0, limit)));
      setRefsLoading(false);
    },
    [
      readsEnabled,
      address,
      effectiveChainId,
      publicClient,
      registryAddress,
      refsOpen,
    ],
  );

  useEffect(() => {
    if (!ready) return;
    if (!readsEnabled) return;
    void refreshCore();
    void loadReferees(refsOpen ? 500 : 25);
    const id = window.setInterval(() => {
      void refreshCore();
      void loadReferees(refsOpen ? 500 : 25);
    }, 12000);
    return () => window.clearInterval(id);
  }, [ready, readsEnabled, refreshCore, loadReferees, refsOpen]);

  // ----- Distributor -----
  const distributorReadsEnabled =
    ready &&
    !!effectiveChainId &&
    isConnected &&
    !!address &&
    distributorAddress !== zeroAddress &&
    !wrongWalletForSelected &&
    !!publicClient;

  const [currentEpoch, setCurrentEpoch] = useState<bigint>(0n);
  const [epochMetaRaw, setEpochMetaRaw] = useState<any>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState<boolean>(false);

  const refreshDistributor = useCallback(async () => {
    if (
      !distributorReadsEnabled ||
      !publicClient ||
      !effectiveChainId ||
      !address
    )
      return;
    const pc = publicClient as any;
    const dist = distributorAddress as `0x${string}`;

    const e = await tryReadContract<any>({
      publicClient: pc,
      address: dist,
      abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
      functionName: "currentEpoch",
      args: [],
    });

    let epoch = 0n;
    const b = bi(e);
    if (b !== null) epoch = b;
    setCurrentEpoch(epoch);

    if (epoch > 0n) {
      const meta = await tryReadContract<any>({
        publicClient: pc,
        address: dist,
        abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
        functionName: "epochs",
        args: [epoch],
      });
      setEpochMetaRaw(meta ?? null);

      const claimed = await tryReadContract<any>({
        publicClient: pc,
        address: dist,
        abi: WEEKLY_REWARDS_DISTRIBUTOR_ABI,
        functionName: "claimed",
        args: [epoch, address as `0x${string}`],
      });
      setAlreadyClaimed(Boolean(claimed));
    } else {
      setEpochMetaRaw(null);
      setAlreadyClaimed(false);
    }
  }, [
    distributorReadsEnabled,
    publicClient,
    effectiveChainId,
    address,
    distributorAddress,
  ]);

  useEffect(() => {
    if (!ready) return;
    void refreshDistributor();
    const id = window.setInterval(() => void refreshDistributor(), 12000);
    return () => window.clearInterval(id);
  }, [ready, refreshDistributor]);

  // ----- Referral code display -----
  const myCodeHex = myPublicCode;
  const haveCode =
    !!myCodeHex &&
    isHex(myCodeHex) &&
    myCodeHex.length === 66 &&
    isNonZeroBytes32(myCodeHex);

  const myCodeFriendly = useMemo(() => {
    if (!haveCode || !myCodeHex) return "";
    const bytes = hexToBytes32(myCodeHex);
    if (!bytes) return "";
    return base32Encode(bytes);
  }, [haveCode, myCodeHex]);

  const myCodeFriendlyPretty = useMemo(
    () => (myCodeFriendly ? formatCodeGroups(myCodeFriendly) : ""),
    [myCodeFriendly],
  );

  const referralLink = useMemo(() => {
    if (!myCodeFriendly) return "";
    return `${SITE_ORIGIN}/play?ref=${encodeURIComponent(myCodeFriendly)}`;
  }, [myCodeFriendly]);

  const isBound = referrerOfMe !== zeroAddress;
  const [refInput, setRefInput] = useState("");

  const parsedRef = useMemo(() => {
    const raw = (refInput || "").trim();
    if (!raw) return { kind: "empty" as const };
    if (isHexAddress(raw))
      return { kind: "address" as const, address: raw as `0x${string}` };
    const code = parseReferralCodeToHex32(raw);
    if (code) return { kind: "code" as const, code };
    return { kind: "invalid" as const };
  }, [refInput]);

  const [refAddrPublicCode, setRefAddrPublicCode] = useState<Hex | null>(null);

  useEffect(() => {
    let alive = true;
    async function run() {
      setRefAddrPublicCode(null);
      if (!readsEnabled || !publicClient || parsedRef.kind !== "address") return;
      const v = await tryReadContract<any>({
        publicClient: publicClient as any,
        address: registryAddress as `0x${string}`,
        abi: abiFor("publicCodeOf"),
        functionName: "publicCodeOf",
        args: [parsedRef.address],
      });
      if (!alive) return;
      if (typeof v === "string" && isHex(v) && v.length === 66)
        setRefAddrPublicCode(v as Hex);
    }
    void run();
    return () => {
      alive = false;
    };
  }, [readsEnabled, publicClient, registryAddress, parsedRef]);

  const effectiveRefCode = useMemo(() => {
    if (parsedRef.kind === "code") return parsedRef.code as Hex;
    if (parsedRef.kind === "address") {
      if (
        refAddrPublicCode &&
        isHex(refAddrPublicCode) &&
        refAddrPublicCode.length === 66 &&
        isNonZeroBytes32(refAddrPublicCode)
      ) {
        return refAddrPublicCode;
      }
      return null;
    }
    return null;
  }, [parsedRef, refAddrPublicCode]);

  const [resolvesTo, setResolvesTo] = useState<string>(zeroAddress);

  useEffect(() => {
    let alive = true;
    async function run() {
      setResolvesTo(zeroAddress);
      if (!readsEnabled || !publicClient || !effectiveRefCode) return;
      const v = await tryReadContract<any>({
        publicClient: publicClient as any,
        address: registryAddress as `0x${string}`,
        abi: abiFor("resolveReferrer"),
        functionName: "resolveReferrer",
        args: [effectiveRefCode as Hex],
      });
      if (!alive) return;
      if (typeof v === "string") setResolvesTo(v);
    }
    void run();
    return () => {
      alive = false;
    };
  }, [readsEnabled, publicClient, registryAddress, effectiveRefCode]);

  // ----- Claim bundle fetch -----
  const [bundleStatus, setBundleStatus] = useState<string>("");
  const [bundleErr, setBundleErr] = useState<string>("");
  const [bundle, setBundle] = useState<ClaimBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState<boolean>(false);
  const [bundleChecked, setBundleChecked] = useState<boolean>(false);
  const [bundleNotFound, setBundleNotFound] = useState<boolean>(false);

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

  const amountLabel = useMemo(
    () => fmtNum(Number(formatUnits(amountBig, 18)), 6),
    [amountBig],
  );
  const genLossLabel = useMemo(
    () => fmtNum(Number(formatUnits(genLossBig, 18)), 6),
    [genLossBig],
  );

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
    setBundleStatus("Checking GitHub bundle…");

    try {
      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        setBundleStatus("");
        setBundleNotFound(true);
        setBundleChecked(true);
        setBundleLoading(false);

        if (res.status !== 404)
          setBundleErr(`Bundle not available. (HTTP ${res.status})`);
        else setBundleErr("");
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

    setBundle(null);
    setBundleErr("");
    setBundleStatus("");
    setBundleNotFound(false);
    setBundleChecked(false);
    setBundleLoading(false);

    void fetchBundle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, address, effectiveChainId, wrongWalletForSelected]);

  // ----- Weekly referee stats (computed client-side from game logs) -----
  const [weeklyStats, setWeeklyStats] = useState<WeeklyRefStats | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyErr, setWeeklyErr] = useState("");
  const [weeklyRefLimit, setWeeklyRefLimit] = useState(50);

  const epochWindow = useMemo(() => {
    if (!epochMetaRaw) return null;
    const start = Number((epochMetaRaw as any)?.[1] ?? 0);
    const end = Number((epochMetaRaw as any)?.[2] ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0)
      return null;
    return { start, end };
  }, [epochMetaRaw]);

  const dtc = (v: bigint) => fmtNum(Number(formatUnits(v, 18)), 6);

  async function findBlockByTimestamp(pc: any, targetTs: number) {
    // binary search on [0, latest]
    const latest = await pc.getBlockNumber();
    let lo = 0n;
    let hi = latest;

    // quick guard
    const hiBlock = await pc.getBlock({ blockNumber: hi });
    const hiTs = Number(hiBlock?.timestamp ?? 0);
    if (Number.isFinite(hiTs) && hiTs < targetTs) return hi;

    // NOTE: Linea/Base have genesis at block 0, timestamp comparisons are fine.
    // We'll cap iterations.
    for (let i = 0; i < 34; i++) {
      const mid = (lo + hi) / 2n;
      const b = await pc.getBlock({ blockNumber: mid });
      const ts = Number(b?.timestamp ?? 0);

      if (!Number.isFinite(ts) || ts <= 0) {
        // if provider returns weird timestamps, just shrink range
        hi = mid > 0n ? mid - 1n : 0n;
        continue;
      }

      if (ts < targetTs) lo = mid + 1n;
      else hi = mid;
    }
    return hi;
  }

  const computeWeeklyRefStats = useCallback(async () => {
    setWeeklyErr("");
    setWeeklyLoading(true);

    try {
      if (
        !ready ||
        !publicClient ||
        !effectiveChainId ||
        !address ||
        wrongWalletForSelected
      ) {
        setWeeklyLoading(false);
        return;
      }
      if (!epochWindow || currentEpoch <= 0n) {
        setWeeklyStats(null);
        setWeeklyLoading(false);
        return;
      }
      if (gameAddress === zeroAddress) {
        setWeeklyErr("GAME address not configured for this chain.");
        setWeeklyLoading(false);
        return;
      }

      const epochId = Number(currentEpoch);
      const key = lsKeyWeekly(effectiveChainId, epochId, address);

      // cached?
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const obj = JSON.parse(cached) as WeeklyRefStats;
          if (
            obj &&
            obj.chainId === effectiveChainId &&
            obj.epochId === epochId &&
            typeof obj.volume === "string"
          ) {
            setWeeklyStats(obj);
            // keep going only if cache is old-ish (optional): we’ll trust it unless user refreshes
            setWeeklyLoading(false);
            return;
          }
        }
      } catch {}

      const pc = publicClient as any;

      const refsAll = refsList.slice(0, clamp(weeklyRefLimit, 1, 500));
      const refs = refsAll
        .map((x) => x.toLowerCase())
        .filter((x) => isHexAddress(x) && x !== zeroAddress);

      if (refs.length === 0) {
        setWeeklyStats({
          chainId: effectiveChainId,
          epochId,
          start: epochWindow.start,
          end: epochWindow.end,
          refereesCount: 0,
          volume: "0",
          wins: "0",
          losses: "0",
          net: "0",
          computedAt: new Date().toISOString(),
        });
        setWeeklyLoading(false);
        return;
      }

      // blocks for epoch window
      const fromBlock = await findBlockByTimestamp(pc, epochWindow.start);
      const toBlock = await findBlockByTimestamp(pc, epochWindow.end);

      // pull logs per referee (topic2=player). This is “cost-free” (RPC),
      // but can be heavy for lots of refs — we limit + cache.
      const createdByGameId = new Map<string, { amountReceived: bigint; player: string }>();
      const settledByGameId = new Map<string, { payout: bigint; player: string }>();

      for (const ref of refs) {
        const t2 = padTopicAddress(ref);
        if (!t2) continue;

        const createdLogs = await pc.getLogs({
          address: gameAddress,
          fromBlock,
          toBlock,
          topics: [TOPIC_GAME_CREATED, null, t2],
        });

        for (const l of createdLogs) {
          try {
            const decoded = decodeEventLog({
              abi: [GAME_EVENT_CREATED],
              data: l.data,
              topics: l.topics,
            }) as any;
            const gid = String(decoded?.args?.gameId || "");
            const player = String(decoded?.args?.player || "").toLowerCase();
            const amountReceived = bi(decoded?.args?.amountReceived) ?? 0n;
            if (isHex(gid) && gid.length === 66 && isHexAddress(player)) {
              createdByGameId.set(gid.toLowerCase(), { amountReceived, player });
            }
          } catch {}
        }

        const settledLogs = await pc.getLogs({
          address: gameAddress,
          fromBlock,
          toBlock,
          topics: [TOPIC_GAME_SETTLED, null, t2],
        });

        for (const l of settledLogs) {
          try {
            const decoded = decodeEventLog({
              abi: [GAME_EVENT_SETTLED],
              data: l.data,
              topics: l.topics,
            }) as any;
            const gid = String(decoded?.args?.gameId || "");
            const player = String(decoded?.args?.player || "").toLowerCase();
            const payout = bi(decoded?.args?.payout) ?? 0n;
            if (isHex(gid) && gid.length === 66 && isHexAddress(player)) {
              settledByGameId.set(gid.toLowerCase(), { payout, player });
            }
          } catch {}
        }
      }

      let volume = 0n;
      let wins = 0n;
      let losses = 0n;

      // Only count games that have BOTH create+settle inside window
      for (const [gid, c] of createdByGameId.entries()) {
        const s = settledByGameId.get(gid);
        if (!s) continue;

        const a = c.amountReceived ?? 0n;
        const p = s.payout ?? 0n;

        volume += a;

        if (p >= a) wins += p - a;
        else losses += a - p;
      }

      const net = wins - losses;

      const out: WeeklyRefStats = {
        chainId: effectiveChainId,
        epochId,
        start: epochWindow.start,
        end: epochWindow.end,
        refereesCount: refs.length,
        volume: volume.toString(),
        wins: wins.toString(),
        losses: losses.toString(),
        net: net.toString(),
        computedAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem(key, JSON.stringify(out));
      } catch {}

      setWeeklyStats(out);
      setWeeklyLoading(false);
    } catch (e: any) {
      setWeeklyLoading(false);
      setWeeklyErr(e?.message || "Failed to compute weekly referee stats.");
    }
  }, [
    ready,
    publicClient,
    effectiveChainId,
    address,
    wrongWalletForSelected,
    epochWindow,
    currentEpoch,
    gameAddress,
    refsList,
    weeklyRefLimit,
  ]);

  // auto-load cached stats when epoch changes / chain changes
  useEffect(() => {
    if (!ready || !effectiveChainId || !address) return;
    if (!epochWindow || currentEpoch <= 0n) {
      setWeeklyStats(null);
      return;
    }
    const epochId = Number(currentEpoch);
    const key = lsKeyWeekly(effectiveChainId, epochId, address);
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const obj = JSON.parse(cached) as WeeklyRefStats;
        if (obj && obj.chainId === effectiveChainId && obj.epochId === epochId)
          setWeeklyStats(obj);
      }
    } catch {}
  }, [ready, effectiveChainId, address, epochWindow, currentEpoch]);

  // ----- Actions -----
  const [status, setStatus] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [bindBusy, setBindBusy] = useState(false);

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

      await (publicClient as any).waitForTransactionReceipt({ hash });

      setStatus("Public code registered ✅");
      window.setTimeout(() => setStatus(""), 1200);

      await refreshCore();
      await loadReferees(refsOpen ? 500 : 25);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Register failed.");
    }
  }

  async function bindToReferrer() {
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
    if (!effectiveRefCode) {
      setErr("Enter a valid referral code or a wallet address.");
      return;
    }
    if (!isHex(effectiveRefCode) || effectiveRefCode.length !== 66) {
      setErr("Invalid code format.");
      return;
    }
    if (
      resolvesTo !== zeroAddress &&
      resolvesTo.toLowerCase() === (address || "").toLowerCase()
    ) {
      setErr("You cannot bind to yourself.");
      return;
    }

    try {
      setBindBusy(true);
      setStatus("Confirm binding in wallet…");

      const hash = await writeContractAsync({
        chainId: effectiveChainId,
        abi: REFERRAL_REGISTRY_ABI,
        address: registryAddress,
        functionName: "bindWithCode",
        args: [effectiveRefCode as Hex],
      });

      await (publicClient as any).waitForTransactionReceipt({ hash });

      setStatus("Referral bound ✅");
      window.setTimeout(() => setStatus(""), 1200);

      await refreshCore();
      await loadReferees(refsOpen ? 500 : 25);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Bind failed.");
    } finally {
      setBindBusy(false);
    }
  }

  const nothingToClaim = useMemo(() => {
    if (!ready) return false;
    if (!bundleChecked) return false;
    if (!isConnected || !address) return false;
    if (!effectiveChainId) return false;
    if (wrongWalletForSelected) return false;
    if (alreadyClaimed) return false;
    if (bundleNotFound) return true;
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

  async function claimWeeklyRewards() {
    setErr("");
    setStatus("");

    if (!claimable) {
      if (nothingToClaim) {
        setErr(
          "Nothing to claim this week. Share your referral code and invite friends to play to start earning.",
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

      await (publicClient as any).waitForTransactionReceipt({ hash });

      setStatus("Weekly claim successful ✅");
      window.setTimeout(() => setStatus(""), 1500);

      await refreshDistributor();
      await refreshCore();
      await loadReferees(refsOpen ? 500 : 25);
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Claim failed.");
    }
  }

  const claimButton = useMemo(() => {
    if (!ready || bundleLoading || (!bundleChecked && isConnected && !!address)) {
      const title =
        baseDisabledReason ||
        (wrongWalletForSelected
          ? "Switch wallet network to match selected chain"
          : "Loading bundle…");

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
    const title = baseDisabledReason || (disabled ? "Claim not available" : "Claim weekly rewards");

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
    alreadyClaimed,
    nothingToClaim,
    claimable,
  ]);

  const nothingToClaimHelper =
    nothingToClaim && ready && isConnected && !wrongWalletForSelected ? (
      <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
        You didn’t earn referral rewards this week.
        <div className="mt-1 text-[11px] text-red-200/80">
          Share your referral code, invite friends to play, and start earning{" "}
          <b>10% weekly</b>.
        </div>
      </div>
    ) : null;

  const bindDisabled =
    !ready ||
    !isConnected ||
    !address ||
    !effectiveChainId ||
    registryAddress === zeroAddress ||
    wrongWalletForSelected ||
    !effectiveRefCode ||
    bindBusy ||
    isBound;

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
        <b className="text-neutral-200">net losses</b>, bundled weekly and claimable on-chain.
      </div>
    </div>
  );

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
                <span className="text-neutral-100">{selectedChain?.name ?? "—"}</span>
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

          {howWorksText}

          {/* Network picker */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Network</div>
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
                  <div className="mt-2 text-[11px] text-amber-200">{switchStatus}</div>
                ) : null}

                {!ready ? (
                  <div className="mt-2 text-[11px] text-neutral-600">Initializing…</div>
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
                    Not connected. The toggle will switch your wallet network after you connect.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Wallet section */}
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

            <div className="mt-2 grid gap-2 md:grid-cols-3">
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
              <div className="text-[12px] text-neutral-500">
                Game:{" "}
                <span className="font-mono text-neutral-300">
                  {gameAddress !== zeroAddress ? gameAddress : "—"}
                </span>
              </div>
            </div>

            {ready && isConnected && wrongWalletForSelected ? (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-200">
                You’re viewing <b>{selectedChain?.name ?? "—"}</b>, but your wallet is on{" "}
                <b>{walletNetworkName}</b>. Switch wallet network using the toggle above.
              </div>
            ) : null}
          </div>

          {/* Bind */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-neutral-100">Bind to a referrer</div>
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
                    Bound to: <span className="font-mono">{truncateAddr(referrerOfMe)}</span>
                  </span>
                ) : (
                  <span className="text-neutral-400">
                    Enter a referral code, bytes32, or a wallet address and sign a binding transaction.
                  </span>
                )
              ) : (
                <span className="text-neutral-400">Connect your wallet to bind.</span>
              )}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <div className="text-[12px] text-neutral-400">Referral code</div>
                <input
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                  placeholder="Paste TOAD-..., 0x... bytes32, or 0x... address"
                  className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <div className="mt-2 text-[11px] text-neutral-500">
                  Resolved referrer:{" "}
                  <span className="font-mono text-neutral-300">
                    {effectiveRefCode ? (resolvesTo === zeroAddress ? "—" : truncateAddr(resolvesTo)) : "—"}
                  </span>
                </div>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void bindToReferrer()}
                  disabled={bindDisabled}
                  className={[
                    "w-full rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    bindDisabled
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                  ].join(" ")}
                  title={
                    wrongWalletForSelected
                      ? "Switch wallet network to match selected chain"
                      : isBound
                        ? "Already bound"
                        : bindBusy
                          ? "Binding…"
                          : undefined
                  }
                >
                  {isBound ? "BOUND" : bindBusy ? "BINDING…" : "BIND"}
                </button>
              </div>
            </div>
          </div>

          {/* My code */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Your referral code</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Your code is per-chain. Registering is optional.
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
                  wrongWalletForSelected ? `Switch wallet to ${selectedChain?.name ?? "selected chain"}` : undefined
                }
              >
                {haveCode ? "RE-REGISTER (optional)" : "REGISTER MY CODE (optional)"}
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] text-neutral-400">Code</div>
                {haveCode ? <Pill tone="good">Active</Pill> : <Pill tone="warn">Not created yet</Pill>}
              </div>

              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-[12px] text-neutral-400">Referral code (friendly)</div>
                  <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                    {haveCode && myCodeFriendlyPretty ? `TOAD-${myCodeFriendlyPretty}` : "—"}
                  </div>
                </div>

                <div>
                  <div className="text-[12px] text-neutral-400">Public code (bytes32)</div>
                  <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                    {haveCode ? myCodeHex : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-3 text-[12px] text-neutral-400">Optional link (uses code)</div>
              <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                {myCodeFriendly ? referralLink : "—"}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!myCodeFriendly) return;
                    const ok = await copyText(`TOAD-${myCodeFriendly}`);
                    if (ok) {
                      setCopiedCode(true);
                      window.setTimeout(() => setCopiedCode(false), 900);
                    }
                  }}
                  disabled={!myCodeFriendly}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    myCodeFriendly
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                      : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                  ].join(" ")}
                >
                  {copiedCode ? "COPIED" : "COPY CODE"}
                </button>

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
                      ? "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60"
                      : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                  ].join(" ")}
                >
                  {copied ? "COPIED" : "COPY LINK"}
                </button>
              </div>
            </div>
          </div>

          {/* Weekly rewards */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Weekly rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Load your claim bundle (GitHub) then claim on-chain.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchBundle()}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                  disabled={!ready || !address || !effectiveChainId || wrongWalletForSelected || bundleLoading}
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
                <div className="text-[12px] text-neutral-400">Bundle amount (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {bundleChecked ? (bundle ? amountLabel : "0") : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Bundle net loss basis (DTC)</div>
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

            {nothingToClaimHelper}

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
              <div className="mt-3 text-[12px] text-neutral-500">Loading your weekly bundle…</div>
            ) : null}
          </div>

          {/* Referees */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Referees</div>
                <div className="mt-1 text-[12px] text-neutral-500">Total referees (this chain):</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100">
                  {ready && isConnected && !wrongWalletForSelected ? String(refsCount) : "—"}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const next = !refsOpen;
                    setRefsOpen(next);
                    window.setTimeout(() => void loadReferees(next ? 500 : 25), 0);
                  }}
                  disabled={!ready || !readsEnabled || refsCount === 0}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    !ready || !readsEnabled || refsCount === 0
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  {refsOpen ? "COLLAPSE" : "EXPAND"}
                </button>

                <button
                  type="button"
                  onClick={() => void loadReferees(refsOpen ? 500 : 25)}
                  disabled={!ready || !readsEnabled || refsLoading}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    !ready || !readsEnabled || refsLoading
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  {refsLoading ? "REFRESHING…" : "REFRESH"}
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] text-neutral-400">
                  Showing{" "}
                  {refsOpen ? Math.min(refsList.length, refsCount) : Math.min(refsList.length, 25)} of{" "}
                  <span className="text-neutral-200">{refsCount}</span>
                </div>
                {refsLoading ? (
                  <Pill tone="neutral">Loading</Pill>
                ) : refsCount > 0 ? (
                  <Pill tone="good">Live</Pill>
                ) : (
                  <Pill tone="warn">None</Pill>
                )}
              </div>

              {refsError ? (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
                  {refsError}
                </div>
              ) : null}

              <div
                className={[
                  "mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3",
                  refsOpen ? "max-h-80 overflow-auto" : "",
                ].join(" ")}
              >
                {refsCount === 0 ? (
                  <div className="text-[12px] text-neutral-500">No referees yet.</div>
                ) : refsList.length === 0 ? (
                  <div className="text-[12px] text-neutral-500">
                    {refsLoading ? "Loading referees…" : "No on-chain list available in this build."}
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {refsList
                      .slice(0, refsOpen ? refsList.length : Math.min(refsList.length, 25))
                      .map((a) => (
                        <div
                          key={a}
                          className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2"
                        >
                          <div className="font-mono text-[12px] text-neutral-200">
                            {truncateAddr(a)}
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await copyText(a);
                              if (ok) {
                                setStatus("Address copied ✅");
                                window.setTimeout(() => setStatus(""), 900);
                              }
                            }}
                            className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                          >
                            COPY
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Weekly referee stats */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">This week: referees performance</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Computed from on-chain game logs within the current epoch window (cached locally).
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
                  <span className="text-[11px] font-bold text-neutral-400">REF LIMIT</span>
                  <input
                    value={weeklyRefLimit}
                    onChange={(e) => setWeeklyRefLimit(clamp(Number(e.target.value || "0"), 1, 500))}
                    className="w-16 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-[12px] text-neutral-200 outline-none"
                    type="number"
                    min={1}
                    max={500}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void computeWeeklyRefStats()}
                  disabled={!ready || !isConnected || wrongWalletForSelected || weeklyLoading || !epochWindow || refsCount === 0}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    !ready || !isConnected || wrongWalletForSelected || weeklyLoading || !epochWindow || refsCount === 0
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                  ].join(" ")}
                  title={!epochWindow ? "Epoch not set yet" : refsCount === 0 ? "No referees" : undefined}
                >
                  {weeklyLoading ? "COMPUTING…" : weeklyStats ? "RECOMPUTE" : "COMPUTE"}
                </button>
              </div>
            </div>

            {weeklyErr ? (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
                {weeklyErr}
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Referees counted</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {weeklyStats ? String(weeklyStats.refereesCount) : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Volume (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {weeklyStats ? dtc(BigInt(weeklyStats.volume)) : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Wins (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {weeklyStats ? dtc(BigInt(weeklyStats.wins)) : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Losses (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">
                  {weeklyStats ? dtc(BigInt(weeklyStats.losses)) : "—"}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              Net (wins − losses):{" "}
              <span className="font-mono text-neutral-200">
                {weeklyStats ? dtc(BigInt(weeklyStats.net)) : "—"}
              </span>
              {weeklyStats?.computedAt ? (
                <span className="ml-2 text-neutral-600">
                  (cached at {new Date(weeklyStats.computedAt).toLocaleString()})
                </span>
              ) : null}
            </div>
          </div>

          {/* Lifetime totals (registry optional) */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Lifetime totals (registry)</div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Generated loss</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{(myLossTotal ?? 0n).toString()}</div>
                <div className="mt-1 text-[12px] text-neutral-500">{prettyDtc(myLossTotal ?? 0n)} DTC</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="text-[12px] text-neutral-400">Rewards</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{(myRewardsTotal ?? 0n).toString()}</div>
                <div className="mt-1 text-[12px] text-neutral-500">{prettyDtc(myRewardsTotal ?? 0n)} DTC</div>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500">
              Note: your current <span className="font-mono text-neutral-300">LilypadLeapGame</span> contract does not write referral totals into the registry
              (it never calls <span className="font-mono text-neutral-300">ReferralRegistry.addTotals()</span>), so these lifetime totals will stay 0 unless you:
              (A) update the game to call it, or (B) run an off-chain “rewards writer” bot that calls it.
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
