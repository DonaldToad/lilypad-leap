"use client";

import TopNav from "../components/TopNav";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import {
  zeroAddress,
  type Hex,
  isHex,
  formatUnits,
  keccak256,
  toHex,
  decodeEventLog,
  createPublicClient,
  http,
  fallback,
} from "viem";
import { base, linea } from "viem/chains";

import { CHAIN_LIST } from "../lib/chains";

export const DTC_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xEb1fD1dBB8aDDA4fa2b5A5C4bcE34F6F20d125D2",
  8453: "0xFbA669C72b588439B29F050b93500D8b645F9354",
};

const REF_REGISTRY_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xAbD4c0dF150025a1982FC8236e5880EcC9156BeE",
  8453: "0x994a28Bb8d84AacB691bA8773e81dAFC1acEb39B",
};

const LILYPAD_GAME_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0x5Eb6920Af0163e749274619E8076666885Bf0B57",
  8453: "0x05df07E37B8dF836549B28AA3195FD54D57DD845",
};

const LILYPAD_VAULT_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xF4Bf262565e0Cc891857DF08Fe55de5316d0Db45",
  8453: "0x2C853B5a06A1F6C3A0aF4c1627993150c6585eb3",
};

const REFERRAL_REGISTRY_ABI = [
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "address", name: "initialOwner", type: "address" },
      { internalType: "uint16", name: "_defaultRefBps", type: "uint16" },
      { internalType: "uint16", name: "_partnerRefBps", type: "uint16" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  { inputs: [{ internalType: "address", name: "owner", type: "address" }], name: "OwnableInvalidOwner", type: "error" },
  { inputs: [{ internalType: "address", name: "account", type: "address" }], name: "OwnableUnauthorizedAccount", type: "error" },
  { inputs: [], name: "ReentrancyGuardReentrantCall", type: "error" },
  { inputs: [{ internalType: "address", name: "token", type: "address" }], name: "SafeERC20FailedOperation", type: "error" },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: true, internalType: "bytes32", name: "code", type: "bytes32" },
    ],
    name: "Bound",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "uint16", name: "defaultBps", type: "uint16" },
      { indexed: false, internalType: "uint16", name: "partnerBps", type: "uint16" },
    ],
    name: "BpsSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "epochId", type: "uint256" },
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "Claimed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "epochId", type: "uint256" },
      { indexed: false, internalType: "int256", name: "profit", type: "int256" },
      { indexed: false, internalType: "uint256", name: "totalBase", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "rewardsTotal", type: "uint256" },
    ],
    name: "EpochFinalized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "game", type: "address" },
      { indexed: false, internalType: "bool", name: "allowed", type: "bool" },
    ],
    name: "GameSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "previousOwner", type: "address" },
      { indexed: true, internalType: "address", name: "newOwner", type: "address" },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "bool", name: "isPartner", type: "bool" },
    ],
    name: "PartnerSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "bytes32", name: "code", type: "bytes32" },
    ],
    name: "PublicCodeRegistered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "epochId", type: "uint256" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "uint256", name: "amountReceived", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "payout", type: "uint256" },
      { indexed: false, internalType: "int256", name: "houseDelta", type: "int256" },
      { indexed: false, internalType: "uint256", name: "baseAdded", type: "uint256" },
    ],
    name: "TotalsUpdated",
    type: "event",
  },
  { inputs: [], name: "BPS_DENOM", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "TOKEN", outputs: [{ internalType: "contract IERC20", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "WEEK", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "player", type: "address" }, { internalType: "bytes32", name: "code", type: "bytes32" }], name: "bindFor", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "bytes32", name: "code", type: "bytes32" }], name: "bindWithCode", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "uint256", name: "epochId", type: "uint256" }], name: "claim", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "uint256", name: "", type: "uint256" }, { internalType: "address", name: "", type: "address" }], name: "claimed", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], name: "codeToReferrer", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "referrer", type: "address" }], name: "computePublicCode", outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], stateMutability: "pure", type: "function" },
  { inputs: [], name: "currentEpoch", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "defaultRefBps", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "uint256", name: "", type: "uint256" }, { internalType: "address", name: "", type: "address" }], name: "epochBaseOf", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "epochs",
    outputs: [
      { internalType: "bool", name: "finalized", type: "bool" },
      { internalType: "int256", name: "profit", type: "int256" },
      { internalType: "uint256", name: "totalBase", type: "uint256" },
      { internalType: "uint256", name: "rewardsTotal", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [{ internalType: "uint256", name: "epochId", type: "uint256" }], name: "finalizeEpoch", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "referrer", type: "address" }], name: "getRefBps", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "isGame", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "isPartnerReferrer", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "player", type: "address" }, { internalType: "uint256", name: "amountReceived", type: "uint256" }, { internalType: "uint256", name: "payout", type: "uint256" }, { internalType: "uint256", name: "", type: "uint256" }], name: "onGameSettled", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "owner", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "partnerRefBps", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "publicCodeOf", outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "referrerOf", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "referrer_total_generated_loss", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "referrer_total_rewards_base", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "registerMyPublicCode", outputs: [{ internalType: "bytes32", name: "code", type: "bytes32" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "uint16", name: "_defaultRefBps", type: "uint16" }, { internalType: "uint16", name: "_partnerRefBps", type: "uint16" }], name: "setBps", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "game", type: "address" }, { internalType: "bool", name: "allowed", type: "bool" }], name: "setGame", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "referrer", type: "address" }, { internalType: "bool", name: "v", type: "bool" }], name: "setPartner", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "newOwner", type: "address" }], name: "transferOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

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

function isHexAddress(x: string) {
  const s = (x || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

const B32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ZERO_B32 = ("0x" + "00".repeat(32)) as Hex;

function isNonZeroBytes32(x?: string | null) {
  if (!x) return false;
  const s = x.toLowerCase();
  return s.startsWith("0x") && s.length === 66 && (s as Hex) !== ZERO_B32;
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
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
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
  for (let i = 0; i < cleaned.length; i += 4) parts.push(cleaned.slice(i, i + 4));
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

function bi(v: any) {
  if (typeof v === "bigint") return v;
  if (v?.toString) {
    try {
      return BigInt(v.toString());
    } catch {}
  }
  return null;
}

function Pill({ tone, children }: { tone: "neutral" | "good" | "warn" | "bad"; children: React.ReactNode }) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20"
      : tone === "warn"
      ? "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/20"
      : tone === "bad"
      ? "bg-red-500/10 text-red-200 ring-1 ring-red-500/20"
      : "bg-neutral-800/40 text-neutral-200 ring-1 ring-neutral-700/60";

  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function padTopicAddress(addr: string) {
  const a = (addr || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(a)) return null;
  return ("0x" + "0".repeat(24) + a.slice(2)) as `0x${string}`;
}

function safeLower(x?: string) {
  return (x || "").toLowerCase();
}

function max0(x: bigint) {
  return x > 0n ? x : 0n;
}

const REG_EVENT_BOUND = {
  type: "event",
  name: "Bound",
  inputs: [
    { indexed: true, name: "player", type: "address" },
    { indexed: true, name: "referrer", type: "address" },
    { indexed: true, name: "code", type: "bytes32" },
  ],
} as const;

const TOPIC_BOUND = keccak256(toHex("Bound(address,address,bytes32)")) as `0x${string}`;

const ERC20_EVENT_TRANSFER = {
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

const TOPIC_TRANSFER = keccak256(toHex("Transfer(address,address,uint256)")) as `0x${string}`;

function isRateLimitOrUnavailable(err: any) {
  const msg = String(err?.shortMessage || err?.message || err?.details || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("timeout") ||
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||
    msg.includes("forbidden") ||
    msg.includes("403") ||
    msg.includes("bad request") ||
    msg.includes("400")
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withBackoff<T>(fn: () => Promise<T>, maxAttempts = 3) {
  let lastErr: any = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const backoffMs = Math.min(8000, 700 * Math.pow(2, i));
      if (isRateLimitOrUnavailable(e)) await sleep(backoffMs);
      else break;
    }
  }
  throw lastErr;
}

async function getLogsAdaptive(pc: any, req: any, depth = 0): Promise<any[]> {
  const from = req.fromBlock as bigint;
  const to = req.toBlock as bigint;
  try {
    return await withBackoff(() => pc.getLogs(req), 2);
  } catch {
    if (from >= to) return [];
    if (depth >= 10) return [];
    const mid = from + (to - from) / 2n;
    const right = await getLogsAdaptive(pc, { ...req, fromBlock: mid, toBlock: to }, depth + 1);
    const left = mid > from ? await getLogsAdaptive(pc, { ...req, fromBlock: from, toBlock: mid - 1n }, depth + 1) : [];
    return [...right, ...left];
  }
}

async function tryReadContract<T>(params: {
  publicClient: any;
  address: `0x${string}`;
  abi: any;
  functionName: string;
  args: any[];
}): Promise<{ ok: true; value: T } | { ok: false; error: any }> {
  try {
    const v = await params.publicClient.readContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
    });
    return { ok: true, value: v as T };
  } catch (e: any) {
    return { ok: false, error: e };
  }
}

type RefStat = {
  games: number;
  wagered: bigint;
  won: bigint;
  lost: bigint;
  net: bigint;
};

function fmtCountdown(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const dd = d > 0 ? `${d}d ` : "";
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const sss = String(ss).padStart(2, "0");
  return `${dd}${hh}:${mm}:${sss}`;
}

function normalizeRpcList(urls: string[]) {
  const cleaned = urls.map((u) => (u || "").trim()).filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const u of cleaned) {
    const k = u.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(u);
  }
  return uniq;
}

function isBadRpc(url: string) {
  const u = (url || "").toLowerCase();
  if (!u.startsWith("https://")) return true;
  if (u.includes("mainnet.base.org")) return true;
  if (u.includes("base.public-rpc.com")) return true;
  if (u.includes("base.drpc.org")) return true;
  return false;
}

const ERC20_MIN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const SHARE_URL = "https://hop.donaldtoad.com/earn";

function buildShareMessage(code: string) {
  return `🐸 Join me on Lilypad Leap!

Bind my referral code: 
${code}
${SHARE_URL}

Start hopping to earn rewards 🎮`;
}

async function shareTextOrTweet(text: string) {
  const isMobile =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

  if (isMobile && (navigator as any)?.share) {
    try {
      await (navigator as any).share({ text });
      return { ok: true as const, mode: "native" as const };
    } catch {}
  }

  const tweetText = text.replace(SHARE_URL, "").trim();
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    tweetText + "\n\n"
  )}&url=${encodeURIComponent(SHARE_URL)}`;

  try {
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
    return { ok: true as const, mode: "twitter" as const };
  } catch {
    return { ok: false as const, mode: "twitter" as const };
  }
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
    const filtered = CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any));
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort((a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99));
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(TOKEN_CHAIN_IDS[0]);

  useEffect(() => {
    if (!ready) return;
    if (isTokenChain(walletChainId)) setSelectedChainId(walletChainId);
  }, [ready, walletChainId]);

  const selectedChain = useMemo(
    () => chains.find((c) => c.chainId === selectedChainId) ?? chains[0],
    [chains, selectedChainId]
  );

  const effectiveChainId = ready ? selectedChainId : undefined;

  const registryAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (REF_REGISTRY_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const gameAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (LILYPAD_GAME_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const vaultAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (LILYPAD_VAULT_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const tokenAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (DTC_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const distributorAddress = registryAddress;

  const rpcClientCache = useRef<Record<number, any>>({});

  const getRpcClient = useCallback((chainId: number | undefined) => {
    if (!chainId) return null;
    if (rpcClientCache.current[chainId]) return rpcClientCache.current[chainId];

    const infuraLinea = (process.env.NEXT_PUBLIC_INFURA_LINEA || "").trim();
    const alchemyBase = (process.env.NEXT_PUBLIC_ALCHEMY_BASE || "").trim();

    const baseFallback = ["https://base-rpc.publicnode.com", "https://1rpc.io/base", "https://rpc.ankr.com/base"];
    const lineaFallback = ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://1rpc.io/linea"];

    const rawUrls =
      chainId === 8453 ? [alchemyBase, ...baseFallback] : chainId === 59144 ? [infuraLinea, ...lineaFallback] : [];
    const urls = normalizeRpcList(rawUrls).filter((u) => u && !isBadRpc(u));

    const chainObj = chainId === 8453 ? base : chainId === 59144 ? linea : undefined;
    if (!chainObj || !urls.length) return null;

    const transports = urls.map((u) => http(u, { timeout: 15_000, retryCount: 0 }));
    const transport = transports.length === 1 ? transports[0] : fallback(transports, { rank: false });

    const pc = createPublicClient({
      chain: chainObj,
      transport,
      batch: { multicall: true },
    });

    rpcClientCache.current[chainId] = pc;
    return pc;
  }, []);

  const publicClient = useMemo(() => getRpcClient(effectiveChainId), [getRpcClient, effectiveChainId]);

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

  const pauseUntilRef = useRef<number>(0);
  const [rpcIssue, setRpcIssue] = useState<string>("");

  const markRpcIssue = useCallback((e: any) => {
    if (!isRateLimitOrUnavailable(e)) return;
    const now = Date.now();
    const until = now + 45_000;
    if (pauseUntilRef.current < until) pauseUntilRef.current = until;
    const msg = String(e?.shortMessage || e?.message || "RPC unavailable.");
    const lower = msg.toLowerCase();
    if (lower.includes("403") || lower.includes("forbidden")) setRpcIssue("RPC forbidden (403). Pausing reads briefly…");
    else if (lower.includes("400") || lower.includes("bad request")) setRpcIssue("RPC bad request (400). Pausing reads briefly…");
    else if (lower.includes("429")) setRpcIssue("RPC rate-limited (429). Pausing reads briefly…");
    else setRpcIssue("RPC unavailable. Pausing reads briefly…");
  }, []);

  const readsEnabled =
    ready &&
    !!effectiveChainId &&
    isConnected &&
    !!address &&
    registryAddress !== zeroAddress &&
    !wrongWalletForSelected &&
    !!publicClient &&
    Date.now() >= pauseUntilRef.current;

  const [referrerOfMe, setReferrerOfMe] = useState<string>(zeroAddress);
  const [myPublicCode, setMyPublicCode] = useState<Hex | null>(null);
  const [myComputedCode, setMyComputedCode] = useState<Hex | null>(null);
  const [myRegistered, setMyRegistered] = useState<boolean>(false);

  const [refsCount, setRefsCount] = useState<number>(0);
  const [refsList, setRefsList] = useState<string[]>([]);
  const [refsOpen, setRefsOpen] = useState<boolean>(false);
  const [refsLoading, setRefsLoading] = useState<boolean>(false);
  const [refsScanComplete, setRefsScanComplete] = useState<boolean>(false);
  const [refsScanFromBlock, setRefsScanFromBlock] = useState<string>("—");
  const refsCursorRef = useRef<bigint | null>(null);
  const refsLatestRef = useRef<bigint>(0n);
  const boundSetRef = useRef<Set<string>>(new Set());

  const [refStatsLoading, setRefStatsLoading] = useState(false);
  const [refStatsPartial, setRefStatsPartial] = useState(false);
  const [refStatsFromBlock, setRefStatsFromBlock] = useState<string>("—");
  const [refStatsByRef, setRefStatsByRef] = useState<Record<string, RefStat>>({});
  const statsCursorRef = useRef<bigint | null>(null);
  const statsLatestRef = useRef<bigint>(0n);
  const statsAggRef = useRef<Record<string, { games: number; wagered: bigint; won: bigint }>>({});

  const [registryOwner, setRegistryOwner] = useState<string>(zeroAddress);
  const [defaultRefBps, setDefaultRefBps] = useState<bigint>(0n);
  const [partnerRefBps, setPartnerRefBps] = useState<bigint>(0n);
  const [adminTargetEpoch, setAdminTargetEpoch] = useState<bigint>(0n);
  const [adminEpochRaw, setAdminEpochRaw] = useState<any>(null);
  const [registryTokenBal, setRegistryTokenBal] = useState<bigint>(0n);

  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMsg, setAdminMsg] = useState<string>("");

  const resetAll = useCallback(() => {
    setReferrerOfMe(zeroAddress);
    setMyPublicCode(null);
    setMyComputedCode(null);
    setMyRegistered(false);

    setRefsCount(0);
    setRefsList([]);
    setRefsLoading(false);
    setRefsScanComplete(false);
    setRefsScanFromBlock("—");
    refsCursorRef.current = null;
    refsLatestRef.current = 0n;
    boundSetRef.current = new Set();

    setRefStatsLoading(false);
    setRefStatsPartial(false);
    setRefStatsFromBlock("—");
    setRefStatsByRef({});
    statsCursorRef.current = null;
    statsLatestRef.current = 0n;
    statsAggRef.current = {};

    setRegistryOwner(zeroAddress);
    setDefaultRefBps(0n);
    setPartnerRefBps(0n);
    setAdminTargetEpoch(0n);
    setAdminEpochRaw(null);
    setRegistryTokenBal(0n);
    setAdminBusy(false);
    setAdminMsg("");

    setRpcIssue("");
    pauseUntilRef.current = 0;
  }, []);

  useEffect(() => {
    resetAll();
  }, [resetAll, effectiveChainId, address]);

  const refreshCore = useCallback(async () => {
    if (!readsEnabled || !address || !publicClient) return;
    const me = address as `0x${string}`;
    const pc = publicClient as any;

    try {
      const compR = await tryReadContract<any>({
        publicClient: pc,
        address: registryAddress,
        abi: REFERRAL_REGISTRY_ABI,
        functionName: "computePublicCode",
        args: [me],
      });

      const computed =
        compR.ok && typeof compR.value === "string" && isHex(compR.value) && compR.value.length === 66 ? (compR.value as Hex) : null;
      setMyComputedCode(computed);

      const codeToR =
        computed && isHex(computed)
          ? await tryReadContract<any>({
              publicClient: pc,
              address: registryAddress,
              abi: REFERRAL_REGISTRY_ABI,
              functionName: "codeToReferrer",
              args: [computed],
            })
          : null;

      const registered =
        !!computed &&
        !!codeToR &&
        codeToR.ok &&
        typeof codeToR.value === "string" &&
        isHexAddress(codeToR.value) &&
        safeLower(codeToR.value) === safeLower(me);

      setMyRegistered(registered);

      const pubR = await tryReadContract<any>({
        publicClient: pc,
        address: registryAddress,
        abi: REFERRAL_REGISTRY_ABI,
        functionName: "publicCodeOf",
        args: [me],
      });

      const pub =
        pubR.ok && typeof pubR.value === "string" && isHex(pubR.value) && pubR.value.length === 66 ? (pubR.value as Hex) : (ZERO_B32 as Hex);

      setMyPublicCode(pub);

      const refR = await tryReadContract<any>({
        publicClient: pc,
        address: registryAddress,
        abi: REFERRAL_REGISTRY_ABI,
        functionName: "referrerOf",
        args: [me],
      });

      const ref =
        refR.ok && typeof refR.value === "string" && isHexAddress(refR.value) ? (refR.value as `0x${string}`) : (zeroAddress as `0x${string}`);
      setReferrerOfMe(ref);

      setRpcIssue("");
    } catch (e: any) {
      markRpcIssue(e);
    }
  }, [readsEnabled, address, publicClient, registryAddress, markRpcIssue]);

  useEffect(() => {
    if (!ready || !readsEnabled) return;
    void refreshCore();
  }, [ready, readsEnabled, refreshCore]);

  const scanMutex = useRef(Promise.resolve());
  const enqueue = useCallback(async <T,>(work: () => Promise<T>) => {
    const run = async () => work();
    const next = scanMutex.current.then(run, run);
    scanMutex.current = next.then(
      () => undefined,
      () => undefined
    ) as any;
    return next;
  }, []);

  const loadRefereesStep = useCallback(
    async (targetListSize: number, forceBig = false) => {
      return enqueue(async () => {
        if (!readsEnabled || !publicClient || !effectiveChainId || !address || registryAddress === zeroAddress) {
          setRefsCount(0);
          setRefsList([]);
          setRefsScanComplete(false);
          setRefsScanFromBlock("—");
          return;
        }

        const me = (address as `0x${string}`).toLowerCase() as `0x${string}`;
        const pc = publicClient as any;

        setRefsLoading(true);

        let latest: bigint;
        try {
          latest = await withBackoff(() => pc.getBlockNumber(), 2);
        } catch (e: any) {
          markRpcIssue(e);
          setRefsLoading(false);
          return;
        }
        refsLatestRef.current = latest;
        if (refsCursorRef.current === null) refsCursorRef.current = latest;

        const cursor = refsCursorRef.current ?? latest;
        const chunkSize = forceBig || refsOpen ? 120_000n : 45_000n;

        const from = cursor > chunkSize ? cursor - chunkSize + 1n : 0n;
        const to = cursor;

        const refTopic = padTopicAddress(me);
        if (!refTopic) {
          setRefsLoading(false);
          return;
        }

        let logs: any[] = [];
        try {
          logs = await getLogsAdaptive(pc, {
            address: registryAddress,
            fromBlock: from,
            toBlock: to,
            topics: [TOPIC_BOUND, null, refTopic],
          });
        } catch (e: any) {
          markRpcIssue(e);
          setRefsLoading(false);
          return;
        }

        const set = boundSetRef.current;
        for (const l of logs) {
          try {
            const decoded = decodeEventLog({ abi: [REG_EVENT_BOUND], data: l.data, topics: l.topics }) as any;
            const player = String(decoded?.args?.player || "").toLowerCase();
            const referrer = String(decoded?.args?.referrer || "").toLowerCase();
            if (!isHexAddress(player) || player === zeroAddress) continue;
            if (player === me) continue;
            if (!isHexAddress(referrer) || referrer !== me) continue;
            set.add(player);
          } catch {}
        }

        const all = Array.from(set).sort();
        setRefsCount(all.length);
        setRefsList(all.slice(0, refsOpen ? all.length : Math.min(all.length, targetListSize)));

        const nextCursor = from === 0n ? 0n : from - 1n;
        const complete = from === 0n;

        refsCursorRef.current = complete ? 0n : nextCursor;
        setRefsScanComplete(complete);
        setRefsScanFromBlock(refsCursorRef.current.toString());

        setRefsLoading(false);
        setRpcIssue("");
      });
    },
    [enqueue, readsEnabled, publicClient, effectiveChainId, address, registryAddress, refsOpen, markRpcIssue]
  );

  const computeRefStatsStep = useCallback(
    async (forceBig = false) => {
      return enqueue(async () => {
        if (!readsEnabled || !publicClient || !effectiveChainId || !address) {
          setRefStatsByRef({});
          setRefStatsPartial(false);
          setRefStatsFromBlock("—");
          return;
        }

        const pc = publicClient as any;
        const tokenAddr = tokenAddress;
        const vault = vaultAddress;

        if (tokenAddr === zeroAddress || vault === zeroAddress) {
          setRefStatsByRef({});
          setRefStatsPartial(false);
          setRefStatsFromBlock("—");
          return;
        }

        setRefStatsLoading(true);

        let latest: bigint;
        try {
          latest = await withBackoff(() => pc.getBlockNumber(), 2);
        } catch (e: any) {
          markRpcIssue(e);
          setRefStatsLoading(false);
          return;
        }
        statsLatestRef.current = latest;

        if (statsCursorRef.current === null) statsCursorRef.current = latest;

        const cursor = statsCursorRef.current ?? latest;
        const chunkSize = forceBig || refsOpen ? 120_000n : 45_000n;

        const from = cursor > chunkSize ? cursor - chunkSize + 1n : 0n;
        const to = cursor;

        const vaultTopic = padTopicAddress(vault);
        if (!vaultTopic) {
          setRefStatsLoading(false);
          return;
        }

        const bound = boundSetRef.current;
        const useBoundFilter = bound.size > 0;

        let wagerLogs: any[] = [];
        let payoutLogs: any[] = [];
        try {
          wagerLogs = await getLogsAdaptive(pc, { address: tokenAddr, fromBlock: from, toBlock: to, topics: [TOPIC_TRANSFER, null, vaultTopic] });
          payoutLogs = await getLogsAdaptive(pc, { address: tokenAddr, fromBlock: from, toBlock: to, topics: [TOPIC_TRANSFER, vaultTopic, null] });
        } catch (e: any) {
          markRpcIssue(e);
          setRefStatsLoading(false);
          return;
        }

        const agg = statsAggRef.current;

        for (const l of wagerLogs) {
          try {
            const decoded = decodeEventLog({ abi: [ERC20_EVENT_TRANSFER], data: l.data, topics: l.topics }) as any;
            const fromAddr = String(decoded?.args?.from || "").toLowerCase();
            const toAddr = String(decoded?.args?.to || "").toLowerCase();
            if (!isHexAddress(fromAddr) || !isHexAddress(toAddr)) continue;
            if (safeLower(toAddr) !== safeLower(vault)) continue;
            if (useBoundFilter && !bound.has(fromAddr)) continue;

            const value = bi(decoded?.args?.value) ?? 0n;
            if (value <= 0n) continue;

            if (!agg[fromAddr]) agg[fromAddr] = { games: 0, wagered: 0n, won: 0n };
            agg[fromAddr].games += 1;
            agg[fromAddr].wagered += value;
          } catch {}
        }

        for (const l of payoutLogs) {
          try {
            const decoded = decodeEventLog({ abi: [ERC20_EVENT_TRANSFER], data: l.data, topics: l.topics }) as any;
            const fromAddr = String(decoded?.args?.from || "").toLowerCase();
            const toAddr = String(decoded?.args?.to || "").toLowerCase();
            if (!isHexAddress(fromAddr) || !isHexAddress(toAddr)) continue;
            if (safeLower(fromAddr) !== safeLower(vault)) continue;
            if (useBoundFilter && !bound.has(toAddr)) continue;

            const value = bi(decoded?.args?.value) ?? 0n;
            if (value <= 0n) continue;

            if (!agg[toAddr]) agg[toAddr] = { games: 0, wagered: 0n, won: 0n };
            agg[toAddr].won += value;
          } catch {}
        }

        const nextCursor = from === 0n ? 0n : from - 1n;
        const complete = from === 0n;
        statsCursorRef.current = complete ? 0n : nextCursor;

        const wantRefs = (refsOpen ? refsList : refsList.slice(0, 25)).map((x) => x.toLowerCase());

        const out: Record<string, RefStat> = {};
        for (const r of wantRefs) {
          const v = agg[r] ?? { games: 0, wagered: 0n, won: 0n };
          const net = v.won - v.wagered;
          const lost = max0(-net);
          out[r] = { games: v.games, wagered: v.wagered, won: v.won, lost, net };
        }

        setRefStatsByRef(out);
        setRefStatsPartial(!complete);
        setRefStatsFromBlock(statsCursorRef.current.toString());

        setRefStatsLoading(false);
        setRpcIssue("");
      });
    },
    [enqueue, readsEnabled, publicClient, effectiveChainId, address, tokenAddress, vaultAddress, refsOpen, refsList, markRpcIssue]
  );

  const distributorReadsEnabled = readsEnabled && distributorAddress !== zeroAddress;

  const [currentEpoch, setCurrentEpoch] = useState<bigint>(0n);
  const [claimEpoch, setClaimEpoch] = useState<bigint>(0n);
  const [epochRaw, setEpochRaw] = useState<any>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState<boolean>(false);
  const [myEpochBaseRegistry, setMyEpochBaseRegistry] = useState<bigint>(0n);
  const [myRefBps, setMyRefBps] = useState<bigint>(0n);
  const [bpsDenom, setBpsDenom] = useState<bigint>(10000n);
  const [weekSec, setWeekSec] = useState<bigint>(604800n);

  const [finalizableAtIso, setFinalizableAtIso] = useState<string>("—");
  const [nextEpochIn, setNextEpochIn] = useState<string>("—");
  const finalizeAtMsRef = useRef<number>(0);

  const refreshDistributor = useCallback(async () => {
    if (!distributorReadsEnabled || !publicClient || !effectiveChainId || !address) return;
    if (Date.now() < pauseUntilRef.current) return;

    const pc = publicClient as any;

    try {
      const res = (await withBackoff(
  () =>
    pc.multicall({
      allowFailure: true,
      contracts: [
        { address: distributorAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "currentEpoch", args: [] },
        { address: distributorAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "BPS_DENOM", args: [] },
        { address: distributorAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "getRefBps", args: [address as `0x${string}`] },
        { address: distributorAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "WEEK", args: [] },
      ],
    }),
  2
)) as any[];

      const eNow = res?.[0]?.status === "success" ? (bi(res[0].result) ?? 0n) : 0n;
      const denom = res?.[1]?.status === "success" ? (bi(res[1].result) ?? 10000n) : 10000n;
      const rbps = res?.[2]?.status === "success" ? (bi(res[2].result) ?? 0n) : 0n;
      const week = res?.[3]?.status === "success" ? (bi(res[3].result) ?? 604800n) : 604800n;

      setCurrentEpoch(eNow);
      setBpsDenom(denom);
      setMyRefBps(rbps);
      setWeekSec(week);

      const claimableEpoch = eNow > 0n ? eNow - 1n : 0n;
      setClaimEpoch(claimableEpoch);

      let meta: any = null;
      if (claimableEpoch > 0n) {
        const metaR = await tryReadContract<any>({
          publicClient: pc,
          address: distributorAddress,
          abi: REFERRAL_REGISTRY_ABI,
          functionName: "epochs",
          args: [claimableEpoch],
        });
        if (!metaR.ok) {
          markRpcIssue(metaR.error);
          return;
        }
        meta = metaR.value;
      }
      setEpochRaw(meta ?? null);

      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const nextBoundarySec = (eNow + 1n) * week;
      const ms = Number(nextBoundarySec) * 1000;

      finalizeAtMsRef.current = ms;
      setFinalizableAtIso(new Date(ms).toISOString());
      setNextEpochIn(fmtCountdown(Number((nextBoundarySec - nowSec) * 1000n)));

      if (claimableEpoch > 0n) {
        const [claimedR, baseR] = (await withBackoff(
  () =>
    pc.multicall({
      allowFailure: true,
      contracts: [
        { address: distributorAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "claimed", args: [claimableEpoch, address as `0x${string}`] },
        { address: distributorAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "epochBaseOf", args: [claimableEpoch, address as `0x${string}`] },
      ],
    }),
  2
)) as any[];

        setAlreadyClaimed(claimedR?.status === "success" ? Boolean(claimedR.result) : false);
        setMyEpochBaseRegistry(baseR?.status === "success" ? (bi(baseR.result) ?? 0n) : 0n);
      } else {
        setAlreadyClaimed(false);
        setMyEpochBaseRegistry(0n);
      }

      setRpcIssue("");
    } catch (e: any) {
      markRpcIssue(e);
    }
  }, [distributorReadsEnabled, publicClient, effectiveChainId, address, distributorAddress, markRpcIssue]);

  useEffect(() => {
    if (!ready) return;

    let alive = true;
    void refreshDistributor();

    const tick = () => {
      if (!alive) return;
      const ms = finalizeAtMsRef.current;
      if (ms > 0) setNextEpochIn(fmtCountdown(ms - Date.now()));
    };

    const sec = window.setInterval(tick, 1000);
    const poll = window.setInterval(() => {
      if (!alive) return;
      if (document.visibilityState !== "visible") return;
      void refreshDistributor();
    }, 60_000);

    return () => {
      alive = false;
      window.clearInterval(sec);
      window.clearInterval(poll);
    };
  }, [ready, refreshDistributor]);

  const claimEpochFinalized = Boolean((epochRaw as any)?.[0]);
  const claimEpochTotalBase = bi((epochRaw as any)?.[2]) ?? 0n;
  const claimEpochRewardsTotal = bi((epochRaw as any)?.[3]) ?? 0n;

  const refreshAdmin = useCallback(async () => {
    if (!readsEnabled || !publicClient || !effectiveChainId || !address) return;
    if (Date.now() < pauseUntilRef.current) return;

    const pc = publicClient as any;

    try {
      const res = (await withBackoff(
  () =>
    pc.multicall({
      allowFailure: true,
      contracts: [
        { address: registryAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "owner", args: [] },
        { address: registryAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "defaultRefBps", args: [] },
        { address: registryAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "partnerRefBps", args: [] },
        { address: registryAddress, abi: REFERRAL_REGISTRY_ABI, functionName: "currentEpoch", args: [] },
      ],
    }),
  2
)) as any[];

      const owner = res?.[0]?.status === "success" && typeof res[0].result === "string" ? (res[0].result as string) : zeroAddress;
      const dBps = res?.[1]?.status === "success" ? (bi(res[1].result) ?? 0n) : 0n;
      const pBps = res?.[2]?.status === "success" ? (bi(res[2].result) ?? 0n) : 0n;
      const eNow = res?.[3]?.status === "success" ? (bi(res[3].result) ?? 0n) : 0n;

      setRegistryOwner(owner);
      setDefaultRefBps(dBps);
      setPartnerRefBps(pBps);

      const target = eNow > 0n ? eNow - 1n : 0n;
      setAdminTargetEpoch(target);

      if (target > 0n) {
        const metaR = await tryReadContract<any>({
          publicClient: pc,
          address: registryAddress,
          abi: REFERRAL_REGISTRY_ABI,
          functionName: "epochs",
          args: [target],
        });
        if (!metaR.ok) {
          markRpcIssue(metaR.error);
          return;
        }
        setAdminEpochRaw(metaR.value ?? null);
      } else {
        setAdminEpochRaw(null);
      }

      if (tokenAddress && tokenAddress !== zeroAddress) {
        const balR = await tryReadContract<any>({
          publicClient: pc,
          address: tokenAddress,
          abi: ERC20_MIN_ABI,
          functionName: "balanceOf",
          args: [registryAddress],
        });
        if (!balR.ok) markRpcIssue(balR.error);
        else setRegistryTokenBal(bi(balR.value) ?? 0n);
      } else {
        setRegistryTokenBal(0n);
      }

      setRpcIssue("");
    } catch (e: any) {
      markRpcIssue(e);
    }
  }, [readsEnabled, publicClient, effectiveChainId, address, registryAddress, tokenAddress, markRpcIssue]);

  useEffect(() => {
    if (!ready || !readsEnabled) return;
    void refreshAdmin();
  }, [ready, readsEnabled, refreshAdmin, currentEpoch]);

  const adminFinalized = Boolean((adminEpochRaw as any)?.[0]);
  const adminTotalBase = bi((adminEpochRaw as any)?.[2]) ?? 0n;
  const adminRewardsTotal = bi((adminEpochRaw as any)?.[3]) ?? 0n;

  const estMaxRewardsBeforeFinalize = useMemo(() => {
    if (adminTargetEpoch <= 0n) return 0n;
    if (bpsDenom <= 0n) return 0n;
    const mx = defaultRefBps > partnerRefBps ? defaultRefBps : partnerRefBps;
    if (mx <= 0n) return 0n;
    if (adminTotalBase <= 0n) return 0n;
    return (adminTotalBase * mx) / bpsDenom;
  }, [adminTargetEpoch, adminTotalBase, defaultRefBps, partnerRefBps, bpsDenom]);

  const neededToMeetAllClaims = useMemo(() => {
    if (adminTargetEpoch <= 0n) return 0n;
    if (adminFinalized) return adminRewardsTotal > 0n ? adminRewardsTotal : 0n;
    return estMaxRewardsBeforeFinalize;
  }, [adminTargetEpoch, adminFinalized, adminRewardsTotal, estMaxRewardsBeforeFinalize]);

  const registryShortfall = useMemo(() => {
    const need = neededToMeetAllClaims;
    const bal = registryTokenBal;
    if (need <= 0n) return 0n;
    return need > bal ? need - bal : 0n;
  }, [neededToMeetAllClaims, registryTokenBal]);

  const dtc = (v: bigint) => fmtNum(Number(formatUnits(v, 18)), 6);

  const [liveEpochBase, setLiveEpochBase] = useState<bigint>(0n);
  const [liveEpochRewards, setLiveEpochRewards] = useState<bigint>(0n);
  const [liveEpochStatus, setLiveEpochStatus] = useState<string>("");

  const [claimEpochBaseComputed, setClaimEpochBaseComputed] = useState<bigint>(0n);
  const [claimEpochRewardsComputed, setClaimEpochRewardsComputed] = useState<bigint>(0n);
  const [claimEpochComputedStatus, setClaimEpochComputedStatus] = useState<string>("");

  const refreshLiveEpochEstimate = useCallback(async () => {
    if (!readsEnabled) return;
    setLiveEpochBase(0n);
    setLiveEpochRewards(0n);
    setLiveEpochStatus("Live estimate uses transfer scanning in SYNC (Referee performance table).");
  }, [readsEnabled]);

  const refreshClaimEpochComputed = useCallback(async () => {
    if (!readsEnabled) return;
    setClaimEpochBaseComputed(0n);
    setClaimEpochRewardsComputed(0n);
    setClaimEpochComputedStatus("Credit check uses registry epochBaseOf (canonical).");
  }, [readsEnabled]);

  useEffect(() => {
    if (!ready || !readsEnabled) return;
    void refreshLiveEpochEstimate();
  }, [ready, readsEnabled, refreshLiveEpochEstimate]);

  useEffect(() => {
    if (!ready || !readsEnabled) return;
    void refreshClaimEpochComputed();
  }, [ready, readsEnabled, refreshClaimEpochComputed]);

  const estRewardsRegistry = useMemo(() => {
    if (!claimEpochFinalized) return 0n;
    if (myEpochBaseRegistry <= 0n) return 0n;
    if (claimEpochRewardsTotal <= 0n) return 0n;
    if (claimEpochTotalBase <= 0n) return 0n;
    return (claimEpochRewardsTotal * myEpochBaseRegistry) / claimEpochTotalBase;
  }, [claimEpochFinalized, myEpochBaseRegistry, claimEpochRewardsTotal, claimEpochTotalBase]);

  const claimMismatch = useMemo(() => false, []);

  const isOwner = useMemo(() => {
    if (!ready || !isConnected || !address) return false;
    return safeLower(address) === safeLower(registryOwner);
  }, [ready, isConnected, address, registryOwner]);

  const canFinalizeLastEpoch = useMemo(() => {
    if (!ready || !isConnected || !address) return false;
    if (!readsEnabled) return false;
    if (!isOwner) return false;
    if (adminBusy) return false;
    if (adminTargetEpoch <= 0n) return false;
    if (adminFinalized) return false;
    if (claimMismatch) return false;
    return true;
  }, [ready, isConnected, address, readsEnabled, isOwner, adminBusy, adminTargetEpoch, adminFinalized, claimMismatch]);

  async function finalizeLastEpoch() {
    setAdminMsg("");
    if (!canFinalizeLastEpoch) return;
    if (!publicClient) return;

    try {
      setAdminBusy(true);
      setAdminMsg("Confirm finalize in wallet…");
      const hash = await writeContractAsync({
        chainId: effectiveChainId!,
        abi: REFERRAL_REGISTRY_ABI,
        address: registryAddress,
        functionName: "finalizeEpoch",
        args: [adminTargetEpoch],
      });
      await (publicClient as any).waitForTransactionReceipt({ hash });
      setAdminMsg(`Finalized epoch ${adminTargetEpoch.toString()} ✅`);
      window.setTimeout(() => setAdminMsg(""), 1500);
      await refreshDistributor();
      await refreshAdmin();
      await refreshClaimEpochComputed();
    } catch (e: any) {
      setAdminMsg(e?.shortMessage || e?.message || "Finalize failed.");
    } finally {
      setAdminBusy(false);
    }
  }

  const isBound = referrerOfMe !== zeroAddress;
  const [refInput, setRefInput] = useState("");

  const parsedRef = useMemo(() => {
    const raw = (refInput || "").trim();
    if (!raw) return { kind: "empty" as const };
    if (isHexAddress(raw)) return { kind: "address" as const, address: raw as `0x${string}` };
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

      const r1 = await tryReadContract<any>({
        publicClient: publicClient as any,
        address: registryAddress,
        abi: REFERRAL_REGISTRY_ABI,
        functionName: "publicCodeOf",
        args: [parsedRef.address],
      });

      if (r1.ok && typeof r1.value === "string" && isHex(r1.value) && r1.value.length === 66 && isNonZeroBytes32(r1.value)) {
        if (alive) setRefAddrPublicCode(r1.value as Hex);
        return;
      }

      const r2 = await tryReadContract<any>({
        publicClient: publicClient as any,
        address: registryAddress,
        abi: REFERRAL_REGISTRY_ABI,
        functionName: "computePublicCode",
        args: [parsedRef.address],
      });

      if (!alive) return;
      if (r2.ok && typeof r2.value === "string" && isHex(r2.value) && r2.value.length === 66) setRefAddrPublicCode(r2.value as Hex);
    }
    void run();
    return () => {
      alive = false;
    };
  }, [readsEnabled, publicClient, registryAddress, parsedRef]);

  const effectiveRefCode = useMemo(() => {
    if (parsedRef.kind === "code") return parsedRef.code as Hex;
    if (parsedRef.kind === "address") {
      if (refAddrPublicCode && isHex(refAddrPublicCode) && refAddrPublicCode.length === 66) return refAddrPublicCode;
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

      const r = await tryReadContract<any>({
        publicClient: publicClient as any,
        address: registryAddress,
        abi: REFERRAL_REGISTRY_ABI,
        functionName: "codeToReferrer",
        args: [effectiveRefCode as Hex],
      });

      if (!r.ok) {
        markRpcIssue(r.error);
        return;
      }
      if (!alive) return;
      if (typeof r.value === "string") setResolvesTo(r.value);
    }
    void run();
    return () => {
      alive = false;
    };
  }, [readsEnabled, publicClient, registryAddress, effectiveRefCode, markRpcIssue]);

  const [status, setStatus] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [bindBusy, setBindBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

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
      setErr("No RPC client for selected chain.");
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
      await (publicClient as any).waitForTransactionReceipt({ hash });
      setStatus("Public code registered ✅");
      window.setTimeout(() => setStatus(""), 1200);
      await refreshCore();
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
      setErr("No RPC client for selected chain.");
      return;
    }
    if (wrongWalletForSelected) {
      setErr(`Switch wallet network to ${selectedChain?.name ?? "selected chain"} first.`);
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
    if (!resolvesTo || resolvesTo === zeroAddress) {
      setErr("This code/address does not resolve to a referrer on this chain. (They must register their code first.)");
      return;
    }
    if (resolvesTo.toLowerCase() === (address || "").toLowerCase()) {
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
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Bind failed.");
    } finally {
      setBindBusy(false);
    }
  }

  const potLow = useMemo(() => {
    if (estRewardsRegistry <= 0n) return false;
    return registryTokenBal < estRewardsRegistry;
  }, [registryTokenBal, estRewardsRegistry]);

  const claimable = useMemo(() => {
    if (!ready) return false;
    if (!isConnected || !address) return false;
    if (!effectiveChainId) return false;
    if (wrongWalletForSelected) return false;
    if (distributorAddress === zeroAddress) return false;
    if (claimEpoch <= 0n) return false;
    if (!claimEpochFinalized) return false;
    if (alreadyClaimed) return false;
    if (estRewardsRegistry <= 0n) return false;
    if (potLow) return false;
    return true;
  }, [
    ready,
    isConnected,
    address,
    effectiveChainId,
    wrongWalletForSelected,
    distributorAddress,
    claimEpoch,
    claimEpochFinalized,
    alreadyClaimed,
    estRewardsRegistry,
    potLow,
  ]);

  const baseDisabledReason = useMemo(() => {
    if (!ready) return "Initializing…";
    if (!isConnected || !address) return "Connect wallet";
    if (!effectiveChainId) return "Select chain";
    if (wrongWalletForSelected) return "Switch wallet network";
    if (distributorAddress === zeroAddress) return "Registry not set";
    if (claimEpoch <= 0n) return "No claim epoch";
    if (!claimEpochFinalized) return "Epoch not finalized";
    if (alreadyClaimed) return "Already claimed";
    if (estRewardsRegistry <= 0n) return "Nothing to claim";
    if (potLow) return "Registry pot low";
    return "";
  }, [
    ready,
    isConnected,
    address,
    effectiveChainId,
    wrongWalletForSelected,
    distributorAddress,
    claimEpoch,
    claimEpochFinalized,
    alreadyClaimed,
    estRewardsRegistry,
    potLow,
  ]);

  async function claimWeeklyRewards() {
    setErr("");
    setStatus("");

    if (!claimable) {
      setErr(baseDisabledReason || "Claim not available.");
      return;
    }
    if (!publicClient) {
      setErr("No RPC client for selected chain.");
      return;
    }

    try {
      setStatus("Confirm claim in wallet…");
      const hash = await writeContractAsync({
        chainId: effectiveChainId!,
        abi: REFERRAL_REGISTRY_ABI,
        address: distributorAddress,
        functionName: "claim",
        args: [claimEpoch],
      });
      await (publicClient as any).waitForTransactionReceipt({ hash });
      setStatus("Weekly claim successful ✅");
      window.setTimeout(() => setStatus(""), 1500);
      await refreshDistributor();
      await refreshCore();
      await refreshAdmin();
      await refreshClaimEpochComputed();
    } catch (e: any) {
      setStatus("");
      setErr(e?.shortMessage || e?.message || "Claim failed.");
    }
  }

  const myCodeForDisplay = useMemo(() => {
    if (myPublicCode && isNonZeroBytes32(myPublicCode)) return myPublicCode;
    if (myComputedCode && isHex(myComputedCode) && myComputedCode.length === 66) return myComputedCode;
    return null;
  }, [myPublicCode, myComputedCode]);

  const myCodeFriendly = useMemo(() => {
    if (!myCodeForDisplay) return "";
    const bytes = hexToBytes32(myCodeForDisplay);
    if (!bytes) return "";
    return base32Encode(bytes);
  }, [myCodeForDisplay]);

  const myCodeFriendlyPretty = useMemo(() => (myCodeFriendly ? formatCodeGroups(myCodeFriendly) : ""), [myCodeFriendly]);
  const myCodeFriendlyPrettyLabel = myCodeFriendlyPretty ? `TOAD-${myCodeFriendlyPretty}` : "—";
  const myShareableCode = useMemo(() => (myCodeFriendly ? `TOAD-${myCodeFriendly}` : ""), [myCodeFriendly]);

  const bindDisabled =
    !ready ||
    !isConnected ||
    !address ||
    !effectiveChainId ||
    registryAddress === zeroAddress ||
    wrongWalletForSelected ||
    !effectiveRefCode ||
    bindBusy ||
    isBound ||
    resolvesTo === zeroAddress;

  const aggRefTotals = useMemo(() => {
    const refs = Object.values(refStatsByRef);
    let wagered = 0n,
      won = 0n,
      lost = 0n,
      net = 0n,
      games = 0;
    for (const r of refs) {
      wagered += r.wagered;
      won += r.won;
      lost += r.lost;
      net += r.net;
      games += r.games;
    }
    return { wagered, won, lost, net, games };
  }, [refStatsByRef]);

  const manualScanHint = useMemo(() => {
    if (!ready || !isConnected || wrongWalletForSelected) return "";
    if (!refsCount && !refsScanComplete) return "Click SYNC once. It will auto-scan history until it catches up.";
    if (!refsScanComplete || refStatsPartial) return "Click SYNC once to auto-finish scanning.";
    return "";
  }, [ready, isConnected, wrongWalletForSelected, refsCount, refsScanComplete, refStatsPartial]);

  const ownerFundingLabel = useMemo(() => {
    if (adminTargetEpoch <= 0n) return "";
    if (adminFinalized) return "Exact required (epoch finalized)";
    return "Estimated max required (before finalize)";
  }, [adminTargetEpoch, adminFinalized]);

  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  const runSync = useCallback(async () => {
    if (!ready || !readsEnabled) return;
    if (syncBusy) return;

    setSyncBusy(true);
    setSyncMsg("Syncing referees + stats…");

    const prevOpen = refsOpen;
    if (!prevOpen) setRefsOpen(true);

    try {
      const maxLoops = 10;
      for (let i = 0; i < maxLoops; i++) {
        if (Date.now() < pauseUntilRef.current) break;

        setSyncMsg(`Syncing… step ${i + 1}/${maxLoops}`);

        await loadRefereesStep(5000, true);
        await computeRefStatsStep(true);

        const doneRefs = refsCursorRef.current === 0n || refsScanComplete;
        const doneStats = statsCursorRef.current === 0n || !refStatsPartial;

        if (doneRefs && doneStats) break;

        await sleep(150);
      }

      setSyncMsg("Refreshing on-chain claim + admin…");
      await refreshDistributor();
      await refreshAdmin();
      await refreshClaimEpochComputed();
      await refreshLiveEpochEstimate();

      setSyncMsg("Sync complete ✅");
      window.setTimeout(() => setSyncMsg(""), 1200);
    } catch (e: any) {
      setSyncMsg("");
      setErr(e?.shortMessage || e?.message || "Sync failed.");
    } finally {
      if (!prevOpen) setRefsOpen(false);
      setSyncBusy(false);
    }
  }, [
    ready,
    readsEnabled,
    syncBusy,
    refsOpen,
    loadRefereesStep,
    computeRefStatsStep,
    refsScanComplete,
    refStatsPartial,
    refreshDistributor,
    refreshAdmin,
    refreshClaimEpochComputed,
    refreshLiveEpochEstimate,
  ]);

  const canShare = useMemo(() => {
    if (!ready || !isConnected || !address) return false;
    if (!myShareableCode) return false;
    if (!myRegistered) return false;
    return true;
  }, [ready, isConnected, address, myShareableCode, myRegistered]);

  async function onShare() {
    setErr("");
    setStatus("");
    if (!canShare) {
      setErr("Register your code first, then share.");
      return;
    }
    if (shareBusy) return;
    try {
      setShareBusy(true);
      const msg = buildShareMessage(myShareableCode);
      const r = await shareTextOrTweet(msg);
      if (r.ok) {
        setStatus(r.mode === "native" ? "Share opened ✅" : "Tweet draft opened ✅");
        window.setTimeout(() => setStatus(""), 1200);
      } else {
        setErr("Share failed.");
      }
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || "Share failed.");
    } finally {
      setShareBusy(false);
    }
  }

  const ownerFundingLabelResolved = ownerFundingLabel;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Earn</h1>
              <p className="mt-2 text-neutral-300">Earn weekly referral rewards on Linea + Base.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
              <span>
                Selected: <span className="text-neutral-100">{selectedChain?.name ?? "—"}</span>
              </span>
              {ready && isConnected ? (
                <span className="text-neutral-500">
                  (wallet: <span className="text-neutral-300">{walletNetworkName}</span>)
                </span>
              ) : null}

              {!ready ? <Pill tone="neutral">Initializing</Pill> : null}
              {ready && !isConnected ? <Pill tone="warn">Not connected</Pill> : null}
              {ready && isConnected && wrongWalletForSelected ? <Pill tone="warn">Wrong network</Pill> : null}
              {ready && isConnected && !wrongWalletForSelected && !rpcIssue ? <Pill tone="good">Ready</Pill> : null}
              {rpcIssue ? <Pill tone="warn">RPC limited</Pill> : null}
            </div>
          </div>

          {rpcIssue ? (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-200">
              {rpcIssue} Use a stable HTTPS RPC via <span className="font-mono">NEXT_PUBLIC_ALCHEMY_BASE</span> /{" "}
              <span className="font-mono">NEXT_PUBLIC_INFURA_LINEA</span>.
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-neutral-100">How referrals work</div>
              <Pill tone="good">On-chain</Pill>
            </div>

            <div className="mt-2 text-[12px] text-neutral-300">
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <div className="text-neutral-200 font-semibold">Create + share</div>
                  <ul className="list-disc pl-5 text-neutral-400">
                    <li>Create your referral code (per-chain) and share it.</li>
                    <li>New players can bind your code once (on that chain).</li>
                  </ul>
                </div>

                <div className="grid gap-1">
                  <div className="text-neutral-200 font-semibold">Weekly rewards</div>
                  <ul className="list-disc pl-5 text-neutral-400">
                    <li>Each week (epoch), the vault may end with a surplus.</li>
                    <li>If it does, a portion of that surplus is allocated to referral rewards.</li>
                    <li>Rewards are split across referrers based on their epoch base (activity attributed to their referees).</li>
                  </ul>
                </div>

                <div className="mt-1 rounded-xl border border-neutral-800 bg-neutral-900/30 p-3">
                  <div className="text-[12px] font-semibold text-neutral-200">When rewards are 0</div>
                  <div className="mt-1 text-[12px] text-neutral-400">
                    If the vault ends the epoch with no surplus (or a deficit), there is nothing to distribute, so claims for that epoch will be 0.
                    Referral rewards are paid from the vault’s weekly surplus (the net difference between amounts sent to the vault and amounts paid out
                    during that epoch). If the vault does not finish the epoch with a surplus, the reward pool is 0 and no referral rewards are distributed.
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900/30 px-3 py-2 text-sm font-extrabold text-neutral-100 hover:bg-neutral-900/45">
                  <span className="inline-flex items-center gap-2">
                    <span>🧪</span>
                    <span>FORMULA</span>
                  </span>
                  <span className="text-[11px] font-semibold text-neutral-500 group-open:hidden">expand</span>
                  <span className="text-[11px] font-semibold text-neutral-500 hidden group-open:inline">collapse</span>
                </summary>

                <div className="mt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12px] text-neutral-500">
                      bps: <span className="font-mono text-neutral-200">{myRefBps.toString()}</span> /{" "}
                      <span className="font-mono text-neutral-200">{bpsDenom.toString()}</span>
                    </div>
                    <Pill tone="neutral">Exact</Pill>
                  </div>

                  <div className="mt-2 whitespace-pre-wrap rounded-xl border border-neutral-800 bg-neutral-900/30 p-3 font-mono text-[11px] leading-5 text-neutral-200">
{`epochId          = floor(block.timestamp / WEEK)

houseDelta        = int(amountReceived) - int(payout)
profit(epochId)  += houseDelta

if houseDelta > 0 and referrerOf[player] != 0x0:
  refBps          = getRefBps(referrer)   // partnerRefBps or defaultRefBps
  baseAdded       = uint(houseDelta) * refBps / BPS_DENOM
  epochBaseOf[epochId][referrer] += baseAdded
  totalBase(epochId)             += baseAdded
else:
  baseAdded       = 0

finalizeEpoch(epochId):
  cap             = profit(epochId) > 0 ? uint(profit(epochId)) : 0
  rewardsTotal    = min(totalBase(epochId), cap)

claim(epochId):
  userBase        = epochBaseOf[epochId][msg.sender]
  amount          = rewardsTotal * userBase / totalBase(epochId)`}
                  </div>

                  <div className="mt-2 text-[11px] text-neutral-500">
                    Notes: only <span className="font-semibold text-neutral-200">positive</span> houseDelta contributes to base; if profit ≤ 0, then cap = 0 and rewardsTotal = 0 → claims are 0.
                  </div>
                </div>
              </details>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
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
                              {active ? (
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
                    Wallet network: <span className="text-neutral-300">{walletNetworkName}</span>
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-neutral-600">Not connected. The toggle will switch your wallet network after you connect.</div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Wallet</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
              {ready && isConnected && address ? `Connected: ${truncateAddr(address)}` : "Not connected"}
              {ready && isConnected && address ? <Pill tone="good">Connected</Pill> : <Pill tone="warn">Connect</Pill>}
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <div className="text-[12px] text-neutral-500">
                Registry: <span className="font-mono text-neutral-300">{registryAddress !== zeroAddress ? registryAddress : "—"}</span>
              </div>
              <div className="text-[12px] text-neutral-500">
                Vault: <span className="font-mono text-neutral-300">{vaultAddress !== zeroAddress ? vaultAddress : "—"}</span>
              </div>
              <div className="text-[12px] text-neutral-500">
                Game: <span className="font-mono text-neutral-300">{gameAddress !== zeroAddress ? gameAddress : "—"}</span>
              </div>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="text-[12px] text-neutral-500">
                Token: <span className="font-mono text-neutral-300">{tokenAddress !== zeroAddress ? tokenAddress : "—"}</span>
              </div>
              <div className="text-[12px] text-neutral-500">
                Registry DTC balance: <span className="font-mono text-neutral-300">{dtc(registryTokenBal)}</span>
              </div>
            </div>

            {ready && isConnected && wrongWalletForSelected ? (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-200">
                You’re viewing <b>{selectedChain?.name ?? "—"}</b>, but your wallet is on <b>{walletNetworkName}</b>. Switch wallet network using the toggle above.
              </div>
            ) : null}
          </div>

          {isOwner ? (
            <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Admin (owner only)</div>
                  <div className="mt-1 text-[12px] text-neutral-500">
                    Owner wallet: <span className="font-mono text-neutral-300">{truncateAddr(registryOwner)}</span>
                  </div>
                  {claimMismatch ? (
                    <div className="mt-2 text-[12px] text-red-200">
                      Finalize blocked: claim epoch mismatch detected for this referrer. Run SYNC and ensure registry credit matches transfers before finalizing.
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => void finalizeLastEpoch()}
                  disabled={!canFinalizeLastEpoch}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    canFinalizeLastEpoch
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                      : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                  ].join(" ")}
                >
                  {adminBusy ? "FINALIZING…" : "FINALIZE LAST EPOCH"}
                </button>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                  <div className="text-[12px] text-neutral-400">Current epoch</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">{currentEpoch.toString()}</div>
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                  <div className="text-[12px] text-neutral-400">Finalize target</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">{adminTargetEpoch.toString()}</div>
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                  <div className="text-[12px] text-neutral-400">Target status</div>
                  <div className="mt-1">{adminFinalized ? <Pill tone="good">Finalized</Pill> : <Pill tone="warn">Not finalized</Pill>}</div>
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                  <div className="text-[12px] text-neutral-400">Registry token balance</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">{dtc(registryTokenBal)}</div>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[12px] text-neutral-400">
                    {ownerFundingLabelResolved}: <span className="font-mono text-neutral-200">{dtc(neededToMeetAllClaims)}</span>{" "}
                    <span className="text-neutral-500">DTC</span>
                  </div>
                  {registryShortfall > 0n ? <Pill tone="bad">Shortfall</Pill> : <Pill tone="good">OK</Pill>}
                </div>

                {registryShortfall > 0n ? (
                  <div className="mt-2 text-[12px] text-red-200">
                    Need to fund Registry with at least <span className="font-mono">{dtc(registryShortfall)}</span> DTC to cover all claims for this epoch.
                  </div>
                ) : (
                  <div className="mt-2 text-[12px] text-emerald-200">Registry has enough DTC to cover all claims for this epoch.</div>
                )}
              </div>

              {adminMsg ? <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-200">{adminMsg}</div> : null}
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-neutral-100">Bind to a referrer</div>
              {ready && isConnected && address ? (isBound ? <Pill tone="good">Bound</Pill> : <Pill tone="warn">Not bound</Pill>) : <Pill tone="neutral">—</Pill>}
            </div>

            <div className="mt-2 text-sm text-neutral-300">
              {ready && isConnected && address ? (
                isBound ? (
                  <span>
                    Bound to: <span className="font-mono">{truncateAddr(referrerOfMe)}</span>
                  </span>
                ) : (
                  <span className="text-neutral-400">Enter a referral code, bytes32, or a wallet address and sign a binding transaction.</span>
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
                  <span className="font-mono text-neutral-300">{effectiveRefCode ? (resolvesTo === zeroAddress ? "—" : truncateAddr(resolvesTo)) : "—"}</span>
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
                >
                  {isBound ? "BOUND" : bindBusy ? "BINDING…" : "BIND"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Lilypad Leap" width={40} height={40} className="h-10 w-10 rounded-xl ring-1 ring-neutral-800" />
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Your referral code</div>
                  <div className="mt-1 text-[12px] text-neutral-500">Your code is per-chain. Registering is required to share.</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void registerCode()}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                disabled={!ready || !isConnected || !address || registryAddress === zeroAddress || wrongWalletForSelected}
              >
                {myRegistered ? "RE-REGISTER (optional)" : "REGISTER MY CODE"}
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] text-neutral-400">Code</div>
                {myRegistered ? (
                  <Pill tone="good">Registered</Pill>
                ) : myCodeForDisplay ? (
                  <Pill tone="warn">Not registered</Pill>
                ) : (
                  <Pill tone="warn">Not created</Pill>
                )}
              </div>

              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-[12px] text-neutral-400">Referral code (friendly)</div>
                  <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">{myCodeFriendlyPrettyLabel}</div>
                </div>

                <div>
                  <div className="text-[12px] text-neutral-400">Public code (bytes32)</div>
                  <div className="mt-1 break-all font-mono text-[12px] text-neutral-200">{myCodeForDisplay ? myCodeForDisplay : "—"}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!myShareableCode || !myRegistered) return;
                    const ok = await copyText(myShareableCode);
                    if (ok) {
                      setCopiedCode(true);
                      window.setTimeout(() => setCopiedCode(false), 900);
                    }
                  }}
                  disabled={!myShareableCode || !myRegistered}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    myShareableCode && myRegistered
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                      : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                  ].join(" ")}
                >
                  {copiedCode ? "COPIED" : "COPY REFERRAL CODE"}
                </button>

                <button
                  type="button"
                  onClick={() => void onShare()}
                  disabled={!canShare || shareBusy}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    canShare && !shareBusy
                      ? "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60"
                      : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                  ].join(" ")}
                >
                  {shareBusy ? "SHARING…" : "SHARE"}
                </button>

                {!myRegistered && myShareableCode ? (
                  <div className="text-[12px] text-neutral-500">
                    Share unlock: click <span className="font-semibold text-neutral-200">REGISTER MY CODE</span> first.
                  </div>
                ) : null}

                {myRegistered && myShareableCode ? (
                  <div className="text-[12px] text-neutral-500">
                    Share link: <span className="font-mono text-neutral-300">{SHARE_URL}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">💰 Weekly rewards</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Claim uses <b className="text-neutral-200">registry-tracked</b> base for the <b className="text-neutral-200">past finalized epoch</b>. Live estimate is shown below.
                </div>
              </div>

              <button
                type="button"
                onClick={() => void claimWeeklyRewards()}
                disabled={!claimable}
                title={baseDisabledReason || undefined}
                className={[
                  "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                  claimable
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                    : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                ].join(" ")}
              >
                {alreadyClaimed ? "CLAIMED" : "CLAIM"}
              </button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-6">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 md:col-span-1">
                <div className="text-[12px] text-neutral-400">Current epoch</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{currentEpoch.toString()}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 md:col-span-1">
                <div className="text-[12px] text-neutral-400">Claim epoch</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{claimEpoch.toString()}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 md:col-span-1">
                <div className="text-[12px] text-neutral-400">Claim base (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{dtc(myEpochBaseRegistry)}</div>
                <div className="mt-1 text-[11px] text-neutral-500">registry epochBaseOf</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 md:col-span-1">
                <div className="text-[12px] text-neutral-400">Claim rewards (DTC)</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{dtc(estRewardsRegistry)}</div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  bps: {myRefBps.toString()} / {bpsDenom.toString()}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 md:col-span-1">
                <div className="text-[12px] text-neutral-400">Next epoch in</div>
                <div className="mt-1 font-mono text-sm text-neutral-200">{nextEpochIn}</div>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 md:col-span-1">
                <div className="text-[12px] text-neutral-400">Epoch boundary (UTC)</div>
                <div className="mt-1 font-mono text-[11px] text-neutral-200">{finalizableAtIso}</div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-neutral-500">
              <span>Live estimate:</span>
              <span className="font-mono text-neutral-200">{dtc(liveEpochRewards)}</span>
              <span className="text-neutral-600">DTC (current epoch)</span>
              {liveEpochStatus ? <Pill tone="warn">Info</Pill> : <Pill tone="good">OK</Pill>}
              <button
                type="button"
                onClick={() => void refreshLiveEpochEstimate()}
                disabled={!ready || !readsEnabled}
                className={[
                  "ml-1 rounded-lg border px-2 py-1 text-[11px] font-extrabold",
                  !ready || !readsEnabled
                    ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                    : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                ].join(" ")}
              >
                REFRESH LIVE
              </button>
            </div>

            {liveEpochStatus ? (
              <div className="mt-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-300">{liveEpochStatus}</div>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Referees</div>
                <div className="mt-1 text-[12px] text-neutral-500">One-click sync loads referees + computes stats + refreshes claim/admin.</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100">
                  {ready && isConnected && !wrongWalletForSelected ? String(refsCount) : "—"}
                </div>

                <button
                  type="button"
                  onClick={() => setRefsOpen((v) => !v)}
                  disabled={!ready || !readsEnabled || refsLoading || refStatsLoading || syncBusy}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    !ready || !readsEnabled || refsLoading || refStatsLoading || syncBusy
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  {refsOpen ? "COLLAPSE" : "EXPAND"}
                </button>

                <button
                  type="button"
                  onClick={() => void runSync()}
                  disabled={!ready || !readsEnabled || syncBusy}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    !ready || !readsEnabled || syncBusy
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                  ].join(" ")}
                >
                  {syncBusy ? "SYNCING…" : "SYNC"}
                </button>

                <button
                  type="button"
                  onClick={() => void loadRefereesStep(refsOpen ? 5000 : 25)}
                  disabled={!ready || !readsEnabled || refsLoading || syncBusy}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    !ready || !readsEnabled || refsLoading || syncBusy
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  {refsLoading ? "SCANNING…" : "REFRESH"}
                </button>

                <button
                  type="button"
                  onClick={() => void computeRefStatsStep()}
                  disabled={!ready || !readsEnabled || refStatsLoading || syncBusy}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-extrabold",
                    !ready || !readsEnabled || refStatsLoading || syncBusy
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  {refStatsLoading ? "CALCULATING…" : "CALC STATS"}
                </button>
              </div>
            </div>

            {syncMsg ? <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-200">{syncMsg}</div> : null}

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] text-neutral-400">
                  Referee list source: <span className="font-mono text-neutral-200">Bound</span> events (player → referrer).
                  <span className="ml-2 text-neutral-600">
                    {refsScanComplete ? "Scan complete" : "Partial scan"} • cursor: <span className="font-mono text-neutral-300">{refsScanFromBlock}</span>
                  </span>
                </div>
                {refsLoading ? <Pill tone="neutral">Loading</Pill> : refsScanComplete ? <Pill tone="good">Complete</Pill> : <Pill tone="warn">Partial</Pill>}
              </div>

              {manualScanHint ? <div className="mt-2 text-[12px] text-neutral-500">{manualScanHint}</div> : null}

              <div className={["mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3", refsOpen ? "max-h-80 overflow-auto" : ""].join(" ")}>
                {refsCount === 0 ? (
                  <div className="text-[12px] text-neutral-500">{refsLoading ? "Scanning…" : "No referees found yet. Click SYNC."}</div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {(refsOpen ? refsList : refsList.slice(0, Math.min(refsList.length, 25))).map((a) => (
                      <div key={a} className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2">
                        <div className="font-mono text-[12px] text-neutral-200">{truncateAddr(a)}</div>
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

            <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Referee performance (waged / won / lost)</div>
                  <div className="mt-1 text-[12px] text-neutral-500">
                    Canonical from DTC <span className="font-mono text-neutral-300">Transfer</span> logs (player ↔ vault).
                    <span className="ml-2 text-neutral-600">
                      {refStatsPartial ? "Partial scan" : "Scan complete"} • cursor: <span className="font-mono text-neutral-300">{refStatsFromBlock}</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {refStatsLoading ? <Pill tone="neutral">Calculating…</Pill> : refStatsPartial ? <Pill tone="warn">Partial</Pill> : <Pill tone="good">Complete</Pill>}
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[12px] text-neutral-400">Waged (sum)</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">{dtc(aggRefTotals.wagered)}</div>
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[12px] text-neutral-400">Won (sum)</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">{dtc(aggRefTotals.won)}</div>
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[12px] text-neutral-400">Lost (sum)</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">{dtc(aggRefTotals.lost)}</div>
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[12px] text-neutral-400">Net (sum)</div>
                  <div className="mt-1 font-mono text-sm text-neutral-200">{dtc(aggRefTotals.net)}</div>
                  <div className="mt-1 text-[11px] text-neutral-500">Games: {String(aggRefTotals.games)}</div>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800">
                <div className="grid grid-cols-[140px_90px_1fr_1fr_1fr] bg-neutral-950 px-4 py-3 text-xs font-semibold text-neutral-300">
                  <div>Referee</div>
                  <div className="text-right">Games</div>
                  <div className="text-right">Waged</div>
                  <div className="text-right">Won</div>
                  <div className="text-right">Lost</div>
                </div>

                <div className="divide-y divide-neutral-800 bg-neutral-950">
                  {(refsOpen ? refsList : refsList.slice(0, 25)).map((r) => {
                    const key = r.toLowerCase();
                    const st = refStatsByRef[key] ?? ({ games: 0, wagered: 0n, won: 0n, lost: 0n, net: 0n } as RefStat);
                    return (
                      <div key={key} className="grid grid-cols-[140px_90px_1fr_1fr_1fr] px-4 py-3 text-sm">
                        <div className="font-mono text-neutral-200">{truncateAddr(key)}</div>
                        <div className="text-right font-semibold text-neutral-200">{String(st.games)}</div>
                        <div className="text-right font-mono text-neutral-200">{dtc(st.wagered)}</div>
                        <div className="text-right font-mono text-neutral-200">{dtc(st.won)}</div>
                        <div className="text-right font-mono text-neutral-200">{dtc(st.lost)}</div>
                      </div>
                    );
                  })}
                  {!refsList.length ? <div className="px-4 py-3 text-[12px] text-neutral-500">No referees yet. Click SYNC.</div> : null}
                </div>
              </div>
            </div>
          </div>

          {status ? <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-200">{status}</div> : null}
          {err ? <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">{err}</div> : null}
        </div>
      </section>
    </main>
  );
}