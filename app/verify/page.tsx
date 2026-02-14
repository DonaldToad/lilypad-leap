// app/verify/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import TopNav from "../components/TopNav";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import { LILYPAD_GAME_BY_CHAIN } from "../lib/addresses";

import { useAccount, useChainId, usePublicClient } from "wagmi";
import {
  decodeEventLog,
  encodePacked,
  formatUnits,
  isHex,
  keccak256,
  zeroAddress,
  type Hex,
  getEventSelector,
} from "viem";

const TOKEN_CHAIN_IDS = [59144, 8453] as const;
type TokenChainId = (typeof TOKEN_CHAIN_IDS)[number];
function isTokenChain(id: number | undefined): id is TokenChainId {
  return !!id && TOKEN_CHAIN_IDS.includes(id as TokenChainId);
}

type ModeKey = "SAFE" | "WILD" | "DEGEN";

const P_BPS: Record<ModeKey, number> = {
  SAFE: 9000,
  WILD: 8200,
  DEGEN: 6900,
};

const MULT_BPS: Record<ModeKey, number[]> = {
  SAFE: [10400, 11600, 12800, 14300, 15900, 17600, 19600, 21800, 24200, 26900],
  WILD: [11100, 13500, 16500, 20100, 24500, 29900, 36400, 44400, 54100, 60000],
  DEGEN: [12000, 16400, 22400, 30600, 41900, 57300, 78300, 107000, 146300, 200000],
};

function clampHop(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, Math.trunc(n)));
}

function shortHex(h: string) {
  if (!h) return "—";
  if (h.length <= 20) return h;
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

async function copyText(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

const GAME_VIEW_ABI = [
  {
    type: "function",
    name: "games",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "bytes32" }],
    outputs: [
      { name: "player", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "createdAt", type: "uint40" },
      { name: "deadline", type: "uint40" },
      { name: "mode", type: "uint8" },
      { name: "userCommit", type: "bytes32" },
      { name: "randAnchor", type: "bytes32" },
      { name: "settled", type: "bool" },
      { name: "cashoutHop", type: "uint8" },
      { name: "payout", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "VAULT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getUserGamesLength",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserGamesSlice",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [{ name: "ids", type: "bytes32[]" }],
  },
] as const;

const EVENTS_ABI = [
  {
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
    anonymous: false,
  },
  {
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
    anonymous: false,
  },
] as const;

const TOPIC_GAME_CREATED = getEventSelector(EVENTS_ABI[0]);
const TOPIC_GAME_SETTLED = getEventSelector(EVENTS_ABI[1]);

function modeFromEnum(v: number): ModeKey {
  if (v === 0) return "SAFE";
  if (v === 1) return "WILD";
  return "DEGEN";
}

function toUInt(n: bigint) {
  return n < 0n ? 0n : n;
}

function computeCommit(userSecret: Hex) {
  return keccak256(encodePacked(["bytes32"], [userSecret])) as Hex;
}

function computeSeed(userSecret: Hex, randAnchor: Hex, vault: Hex, gameId: Hex) {
  return keccak256(
    encodePacked(["bytes32", "bytes32", "address", "bytes32"], [userSecret, randAnchor, vault, gameId])
  ) as Hex;
}

function hopRollBps(seed: Hex, hopNo: number) {
  const h = keccak256(encodePacked(["bytes32", "uint8"], [seed, hopNo])) as Hex;
  return Number(BigInt(h) % 10000n);
}

function normalizeSettledHop(settled: boolean, onHop: number, onPayoutWei: bigint, requestedHop: number) {
  if (!settled) return clampHop(requestedHop);
  if (onHop === 0 && onPayoutWei > 0n) return 10;
  return clampHop(onHop || 1);
}

type SettledFromTx = {
  gameId: Hex;
  player: Hex;
  won: boolean;
  cashoutHop: number;
  payoutWei: bigint;
  userCommitHash?: Hex;
  randAnchor?: Hex;
  txHash: Hex;
} | null;

type VerifyKey = "VERIFIED" | "NOT_VERIFIED" | "NO_SECRET" | "COMMIT_OK" | "CASHED_OUT" | "MAX_HIT";
function verifyChipClasses(k: VerifyKey) {
  if (k === "MAX_HIT") return "bg-emerald-500/10 text-emerald-200 ring-emerald-500/25";
  if (k === "CASHED_OUT") return "bg-amber-500/10 text-amber-200 ring-amber-500/25";
  if (k === "VERIFIED") return "bg-emerald-500/10 text-emerald-200 ring-emerald-500/25";
  if (k === "NOT_VERIFIED") return "bg-red-500/10 text-red-200 ring-red-500/25";
  if (k === "COMMIT_OK") return "bg-sky-500/10 text-sky-200 ring-sky-500/25";
  return "bg-neutral-50/10 text-neutral-300 ring-neutral-200/20";
}

type RecentGameRow = {
  gameId: Hex;
  mode: ModeKey;

  amountWei: bigint;
  amountDtc: string;

  createdAt: number;
  deadline: number;
  userCommit: Hex;
  randAnchor: Hex;
  settled: boolean;

  cashoutHop: number;
  payoutWei: bigint;
  payoutDtc: string;

  createTxHash?: Hex;
  settleTxHash?: Hex;

  verify?: {
    key: VerifyKey;
    label: string;
    detail?: string;
  };
};

type StatusKey = "SETTLED" | "ACTIVE" | "EXPIRED";
function statusChipClasses(label: StatusKey) {
  if (label === "SETTLED") return "bg-emerald-500/10 text-emerald-200 ring-emerald-500/20";
  if (label === "EXPIRED") return "bg-red-500/10 text-red-200 ring-red-500/20";
  return "bg-neutral-50/10 text-neutral-200 ring-neutral-200/20";
}

const SECRET_STORE_KEY = "lilypadLeapSecretsV1";
function secretKey(chainId: number, game: Hex, gameId: Hex) {
  return `${chainId}:${game.toLowerCase()}:${gameId.toLowerCase()}`;
}
function getStoredSecret(chainId: number, game: Hex, gameId: Hex): Hex | null {
  try {
    const raw = localStorage.getItem(SECRET_STORE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, string>;
    const v = obj[secretKey(chainId, game, gameId)];
    if (v && isHex(v) && v.length === 66) return v as Hex;
    return null;
  } catch {
    return null;
  }
}
function setStoredSecret(chainId: number, game: Hex, gameId: Hex, secret: Hex) {
  try {
    const raw = localStorage.getItem(SECRET_STORE_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    obj[secretKey(chainId, game, gameId)] = secret;
    localStorage.setItem(SECRET_STORE_KEY, JSON.stringify(obj));
  } catch {}
}

function autoVerifyRow(params: { seedVault: Hex; row: RecentGameRow; secret: Hex | null }) {
  const { seedVault, row, secret } = params;

  if (!secret) return { key: "NO_SECRET" as const, label: "NO SECRET" };

  const commit = computeCommit(secret);
  if (commit.toLowerCase() !== row.userCommit.toLowerCase()) {
    return { key: "NOT_VERIFIED" as const, label: "NOT VERIFIED", detail: "commit mismatch" };
  }

  if (!row.settled) return { key: "COMMIT_OK" as const, label: "COMMIT OK" };

  const hop = normalizeSettledHop(true, row.cashoutHop, row.payoutWei, row.cashoutHop);

  if (row.payoutWei > 0n && hop === 10) return { key: "MAX_HIT" as const, label: "MAX HIT" };
  if (row.payoutWei > 0n && hop < 10) return { key: "CASHED_OUT" as const, label: "CASHED OUT" };

  const seed = computeSeed(secret, row.randAnchor, seedVault, row.gameId);
  const pBps = P_BPS[row.mode];

  let won = true;
  for (let i = 1; i <= hop; i++) {
    const rBps = hopRollBps(seed, i);
    if (!(rBps < pBps)) {
      won = false;
      break;
    }
  }

  let payoutWei = 0n;
  if (won) {
    const m = BigInt(MULT_BPS[row.mode][hop - 1]);
    payoutWei = (row.amountWei * m) / 10000n;
  }

  const payoutMatches = payoutWei === row.payoutWei;
  const wonMatches = won ? row.payoutWei > 0n : row.payoutWei === 0n;
  const ok = payoutMatches && wonMatches;

  return ok
    ? { key: "VERIFIED" as const, label: "VERIFIED" }
    : { key: "NOT_VERIFIED" as const, label: "NOT VERIFIED", detail: "payout/win mismatch" };
}

async function findTxHashesForGame(params: {
  publicClient: any;
  game: Hex;
  gameId: Hex;
}): Promise<{ createTx?: Hex; settleTx?: Hex }> {
  const { publicClient, game, gameId } = params;
  try {
    const latest = (await publicClient.getBlockNumber()) as bigint;
    const windows = [50_000n, 200_000n, 800_000n, 2_000_000n];

    let foundCreate: Hex | undefined;
    let foundSettle: Hex | undefined;

    for (const w of windows) {
      const fromBlock = latest > w ? latest - w : 0n;

      const createdLogs = (await publicClient.getLogs({
        address: game,
        fromBlock,
        toBlock: latest,
        topics: [TOPIC_GAME_CREATED],
      })) as Array<{ data: Hex; topics: Hex[]; transactionHash: Hex; address: Hex }>;

      for (const log of createdLogs) {
        try {
          const topics = ((log.topics ?? []) as unknown) as `0x${string}`[];
          if (topics.length === 0) continue;

          const decoded = decodeEventLog({
            abi: EVENTS_ABI,
            data: log.data,
            topics: topics as [`0x${string}`, ...`0x${string}`[]],
          });

          if (decoded.eventName !== "GameCreated") continue;
          const gid = (decoded.args as any).gameId as Hex;
          if (gid?.toLowerCase() === gameId.toLowerCase()) {
            foundCreate = log.transactionHash;
            break;
          }
        } catch {}
      }

      const settledLogs = (await publicClient.getLogs({
        address: game,
        fromBlock,
        toBlock: latest,
        topics: [TOPIC_GAME_SETTLED],
      })) as Array<{ data: Hex; topics: Hex[]; transactionHash: Hex; address: Hex }>;

      for (const log of settledLogs) {
        try {
          const topics = ((log.topics ?? []) as unknown) as `0x${string}`[];
          if (topics.length === 0) continue;

          const decoded = decodeEventLog({
            abi: EVENTS_ABI,
            data: log.data,
            topics: topics as [`0x${string}`, ...`0x${string}`[]],
          });

          if (decoded.eventName !== "GameSettled") continue;
          const gid = (decoded.args as any).gameId as Hex;
          if (gid?.toLowerCase() === gameId.toLowerCase()) {
            foundSettle = log.transactionHash;
            break;
          }
        } catch {}
      }

      if (foundCreate || foundSettle) break;
    }

    return { createTx: foundCreate, settleTx: foundSettle };
  } catch {
    return {};
  }
}

const CHAIN_ICON: Record<number, string> = {
  59144: "/chains/linea.png",
  8453: "/chains/base.png",
};

function isCashedOutPre10(settled: boolean, hop: number, payoutWei: bigint) {
  return settled && payoutWei > 0n && hop >= 1 && hop < 10;
}
function isMaxHitCashout(settled: boolean, hop: number, payoutWei: bigint) {
  return settled && payoutWei > 0n && hop === 10;
}

export default function VerifyPage() {
  const { isConnected, address } = useAccount();
  const walletChainId = useChainId();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted;

  const [selectedChainId, setSelectedChainId] = useState<number>(PRIMARY_CHAIN.chainId);
  useEffect(() => {
    if (!ready) return;
    if (isTokenChain(walletChainId)) setSelectedChainId(walletChainId);
  }, [ready, walletChainId]);

  const selectedChain = useMemo(
    () => CHAIN_LIST.find((c) => c.chainId === selectedChainId) ?? PRIMARY_CHAIN,
    [selectedChainId]
  );

  const publicClient = usePublicClient({ chainId: selectedChainId });

  const defaultGame = (LILYPAD_GAME_BY_CHAIN[selectedChainId] ?? zeroAddress) as Hex;
  const [gameOverride, setGameOverride] = useState<string>("");

  const gameAddress = useMemo(() => {
    const v = gameOverride.trim();
    if (v && isHex(v) && v.length === 42) return v as Hex;
    return defaultGame;
  }, [gameOverride, defaultGame]);

  const canUseChain = gameAddress !== zeroAddress;

  const [seedVault, setSeedVault] = useState<Hex>(zeroAddress as Hex);
  const [seedVaultStatus, setSeedVaultStatus] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadVault() {
      setSeedVault(zeroAddress as Hex);
      setSeedVaultStatus("");

      if (!ready || !publicClient || !canUseChain) return;

      try {
        setSeedVaultStatus("Loading VAULT()…");
        const v = (await publicClient.readContract({
          address: gameAddress,
          abi: GAME_VIEW_ABI,
          functionName: "VAULT",
          args: [],
        })) as Hex;

        if (cancelled) return;
        setSeedVault(v);
        setSeedVaultStatus("");
      } catch (e: any) {
        if (cancelled) return;
        setSeedVaultStatus(e?.shortMessage || e?.message || "Failed to read VAULT() from game.");
      }
    }

    void loadVault();
    return () => {
      cancelled = true;
    };
  }, [ready, publicClient, canUseChain, gameAddress]);

  const [gameId, setGameId] = useState<string>("");
  const [userSecret, setUserSecret] = useState<string>("");
  const [cashoutHop, setCashoutHop] = useState<number>(1);
  const [txHash, setTxHash] = useState<string>("");

  const [bundleText, setBundleText] = useState<string>("");
  const [bundleStatus, setBundleStatus] = useState<string>("");

  const [recent, setRecent] = useState<RecentGameRow[]>([]);
  const [recentStatus, setRecentStatus] = useState<string>("");
  const [recentLoading, setRecentLoading] = useState(false);
  const [selectedRecentId, setSelectedRecentId] = useState<string>("");

  const [txParseStatus, setTxParseStatus] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [fromTx, setFromTx] = useState<SettledFromTx>(null);

  const [result, setResult] = useState<null | {
    ok: boolean;
    summary: string;
    bundleJson: string;

    chainId: number;
    game: Hex;
    seedVault: Hex;

    gameId: Hex;
    player: Hex;
    amountWei: bigint;
    amountDtc: string;

    mode: ModeKey;
    pBps: number;

    onchain: {
      userCommit: Hex;
      randAnchor: Hex;
      settled: boolean;
      cashoutHop: number;
      payoutWei: bigint;
      payoutDtc: string;
    };

    computed: {
      commit: Hex;
      seed: Hex;
      won: boolean;
      payoutWei: bigint;
      payoutDtc: string;
      cashoutHop: number;
      rolls: Array<{ hop: number; rBps: number; passed: boolean }>;
    };

    comparisons: {
      commitMatches: boolean;
      payoutMatchesIfSettled: boolean;
      wonMatchesIfSettled: boolean;
      hopMatchesIfSettled: boolean;

      txPayoutMatches?: boolean;
      txWonMatches?: boolean;
      txHopMatches?: boolean;
      txCommitMatches?: boolean;
    };
  }>(null);

  const [nowSec, setNowSec] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    setNowSec(Math.floor(Date.now() / 1000));
  }, [ready]);

  function getStatusKey(row: RecentGameRow, now?: number): StatusKey {
    if (row.settled) return "SETTLED";
    if (now && row.deadline > 0 && now > row.deadline) return "EXPIRED";
    return "ACTIVE";
  }

  useEffect(() => {
    setFromTx(null);
    setTxParseStatus("");
    setRecent([]);
    setRecentStatus("");
    setRecentLoading(false);
    setSelectedRecentId("");
    setTxHash("");
    setErr("");
    setResult(null);
  }, [selectedChainId, gameAddress]);

  async function loadMyRecentGames(count = 20) {
    setErr("");
    setResult(null);
    setFromTx(null);

    if (!ready) return setErr("Page is still initializing. Try again in a second.");
    if (!publicClient) return setErr("No RPC client available for this selected chain.");
    if (!canUseChain) return setErr("Missing game address for this chain (or invalid override).");
    if (!address) return setErr("Connect your wallet to import your recent games.");

    setRecent([]);
    setRecentStatus("");
    setRecentLoading(true);

    try {
      setRecentStatus("Fetching your games…");

      const n = (await publicClient.readContract({
        address: gameAddress,
        abi: GAME_VIEW_ABI,
        functionName: "getUserGamesLength",
        args: [address],
      })) as bigint;

      const total = Number(n);
      if (total <= 0) {
        setRecentStatus("No games found for this wallet on this chain.");
        return;
      }

      const start = Math.max(0, total - count);
      const ids = (await publicClient.readContract({
        address: gameAddress,
        abi: GAME_VIEW_ABI,
        functionName: "getUserGamesSlice",
        args: [address, BigInt(start), BigInt(count)],
      })) as Hex[];

      const newestFirst = [...ids].reverse();
      setRecentStatus("Loading game details…");

      const rows = await Promise.all(
        newestFirst.map(async (gid) => {
          const g = (await publicClient.readContract({
            address: gameAddress,
            abi: GAME_VIEW_ABI,
            functionName: "games",
            args: [gid],
          })) as unknown as [Hex, bigint, bigint, bigint, bigint, Hex, Hex, boolean, bigint, bigint];

          const amountWei = toUInt(g[1]);
          const createdAt = Number(g[2]);
          const deadline = Number(g[3]);
          const mode = modeFromEnum(Number(g[4]));
          const onUserCommit = g[5] as Hex;
          const onRandAnchor = g[6] as Hex;
          const settled = Boolean(g[7]);
          const rawHop = Number(g[8]);
          const payoutWei = toUInt(g[9]);

          const normalizedHop = settled ? normalizeSettledHop(true, rawHop, payoutWei, rawHop) : rawHop;

          const baseRow: RecentGameRow = {
            gameId: gid,
            mode,
            amountWei,
            amountDtc: formatUnits(amountWei, 18),
            createdAt,
            deadline,
            userCommit: onUserCommit,
            randAnchor: onRandAnchor,
            settled,
            cashoutHop: normalizedHop,
            payoutWei,
            payoutDtc: formatUnits(payoutWei, 18),
          };

          const secret = ready ? getStoredSecret(selectedChainId, gameAddress, gid) : null;
          const v = seedVault !== (zeroAddress as Hex) ? autoVerifyRow({ seedVault, row: baseRow, secret }) : undefined;

          return { ...baseRow, verify: v };
        })
      );

      setRecent(rows);

      const verifiedCount = rows.filter((r) => r.verify?.key === "VERIFIED").length;
      const noSecretCount = rows.filter((r) => r.verify?.key === "NO_SECRET").length;

      setRecentStatus(`Loaded ${rows.length} games. Verified: ${verifiedCount}. Missing secret: ${noSecretCount}.`);
      window.setTimeout(() => setRecentStatus(""), 1600);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || "Failed to load recent games.");
      setRecentStatus("");
    } finally {
      setRecentLoading(false);
    }
  }

  async function tryAutofillFromTx(hashIn: string) {
    const hash = hashIn.trim() as Hex;

    setTxParseStatus("");
    setErr("");
    setResult(null);
    setFromTx(null);

    if (!ready) return setTxParseStatus("Page is still initializing.");
    if (!publicClient) return setTxParseStatus("No RPC client available for this selected chain.");
    if (!isHex(hash) || hash.length !== 66) return setTxParseStatus("Paste a valid tx hash (0x… 32 bytes).");
    if (!canUseChain) return setTxParseStatus("Missing game address for this chain (or invalid override).");

    try {
      setTxParseStatus("Fetching receipt…");
      const receipt = await publicClient.getTransactionReceipt({ hash });

      let foundGameId: Hex | null = null;
      let foundHop: number | null = null;
      let settled: SettledFromTx = null;

      for (const log of receipt.logs as Array<{ address: Hex; data: Hex; topics: Hex[] }>) {
        if ((log.address ?? "").toLowerCase() !== gameAddress.toLowerCase()) continue;

        try {
          const topics = ((log.topics ?? []) as unknown) as `0x${string}`[];
          if (topics.length === 0) continue;

          const decoded = decodeEventLog({
            abi: EVENTS_ABI,
            data: log.data,
            topics: topics as [`0x${string}`, ...`0x${string}`[]],
          });

          if (decoded.eventName === "GameCreated") {
            const gid = (decoded.args as any).gameId as Hex;
            foundGameId = gid;
          }

          if (decoded.eventName === "GameSettled") {
            const gid = (decoded.args as any).gameId as Hex;
            foundGameId = gid;

            const hopRaw = Number((decoded.args as any).cashoutHop ?? 0);
            const payoutRaw = toUInt(BigInt((decoded.args as any).payout ?? 0));
            const wonRaw = Boolean((decoded.args as any).won);

            foundHop = hopRaw;

            const normalizedHop = wonRaw ? normalizeSettledHop(true, hopRaw, payoutRaw, hopRaw) : clampHop(hopRaw || 1);

            settled = {
              gameId: gid,
              player: (decoded.args as any).player as Hex,
              won: wonRaw,
              cashoutHop: normalizedHop,
              payoutWei: payoutRaw,
              userCommitHash: (decoded.args as any).userCommitHash as Hex | undefined,
              randAnchor: (decoded.args as any).randAnchor as Hex | undefined,
              txHash: hash,
            };
          }
        } catch {}
      }

      if (!foundGameId) {
        setTxParseStatus("No GameCreated/GameSettled event found in this tx (for this GAME/chain).");
        return;
      }

      setGameId(foundGameId);

      if (settled) {
        setCashoutHop(settled.cashoutHop);
      } else if (foundHop != null) {
        setCashoutHop(clampHop(foundHop));
      }

      setFromTx(settled);

      setTxParseStatus(`Imported from tx${settled ? " (settle)" : ""}.`);
      window.setTimeout(() => setTxParseStatus(""), 1200);
    } catch (e: any) {
      setTxParseStatus("");
      setErr(e?.shortMessage || e?.message || "Failed to parse tx receipt.");
    }
  }

  async function verifyNow() {
    setErr("");
    setResult(null);

    if (!ready) return setErr("Page is still initializing. Try again in a second.");
    if (!publicClient) return setErr("No RPC client available for this selected chain.");
    if (!canUseChain) return setErr("Missing game address for this chain (or invalid override).");
    if (seedVault === (zeroAddress as Hex)) return setErr("Seed vault not loaded yet (GAME.VAULT()).");

    const g = gameId.trim();
    const s = userSecret.trim();

    if (!isHex(g) || g.length !== 66) return setErr("Game ID must be bytes32 hex (0x + 64 hex chars).");
    if (!isHex(s) || s.length !== 66) return setErr("User Secret must be bytes32 hex (0x + 64 hex chars).");

    const gid = g as Hex;
    const secret = s as Hex;

    setLoading(true);
    try {
      const game = (await publicClient.readContract({
        address: gameAddress,
        abi: GAME_VIEW_ABI,
        functionName: "games",
        args: [gid],
      })) as unknown as [Hex, bigint, bigint, bigint, bigint, Hex, Hex, boolean, bigint, bigint];

      const player = game[0] as Hex;
      const amountWei = toUInt(game[1]);
      const mode = modeFromEnum(Number(game[4]));
      const onUserCommit = game[5] as Hex;
      const onRandAnchor = game[6] as Hex;
      const settled = Boolean(game[7]);
      const rawOnHop = Number(game[8]);
      const onPayoutWei = toUInt(game[9]);

      if (player === (zeroAddress as Hex)) throw new Error("Game not found on-chain. Check network/game/gameId.");

      const hop = normalizeSettledHop(settled, rawOnHop, onPayoutWei, cashoutHop);

      const commit = computeCommit(secret);
      const commitMatches = commit.toLowerCase() === onUserCommit.toLowerCase();

      const seed = computeSeed(secret, onRandAnchor, seedVault, gid);
      const pBps = P_BPS[mode];

      const rolls: Array<{ hop: number; rBps: number; passed: boolean }> = [];
      let won = true;
      for (let i = 1; i <= hop; i++) {
        const rBps = hopRollBps(seed, i);
        const passed = rBps < pBps;
        rolls.push({ hop: i, rBps, passed });
        if (!passed) {
          won = false;
          break;
        }
      }

      let payoutWei = 0n;
      if (won) {
        const m = BigInt(MULT_BPS[mode][hop - 1]);
        payoutWei = (amountWei * m) / 10000n;
      }

      const amountDtc = formatUnits(amountWei, 18);
      const payoutDtc = formatUnits(payoutWei, 18);
      const onPayoutDtc = formatUnits(onPayoutWei, 18);

      const normalizedOnHopForCompare = normalizeSettledHop(settled, rawOnHop, onPayoutWei, rawOnHop);
      const hopMatchesIfSettled = !settled ? true : hop === normalizedOnHopForCompare;

      const payoutMatchesIfSettled = !settled ? true : payoutWei === onPayoutWei;
      const wonMatchesIfSettled = !settled ? true : won ? onPayoutWei > 0n : onPayoutWei === 0n;

      const txPayoutMatches = fromTx ? payoutWei === fromTx.payoutWei : undefined;
      const txWonMatches = fromTx ? won === fromTx.won : undefined;
      const txHopMatches = fromTx ? hop === fromTx.cashoutHop : undefined;
      const txCommitMatches = fromTx?.userCommitHash ? commit.toLowerCase() === fromTx.userCommitHash.toLowerCase() : undefined;

      const strictOk =
        commitMatches &&
        hopMatchesIfSettled &&
        payoutMatchesIfSettled &&
        wonMatchesIfSettled &&
        (txPayoutMatches ?? true) &&
        (txWonMatches ?? true) &&
        (txHopMatches ?? true) &&
        (txCommitMatches ?? true);

      const cashoutPre10 = isCashedOutPre10(settled, hop, onPayoutWei);
      const maxHit = isMaxHitCashout(settled, hop, onPayoutWei);

      let ok = strictOk;
      let summary: string;

      if (maxHit && commitMatches && strictOk) {
        summary = "MAX HIT CASHOUT!";
        ok = true;
      } else if (cashoutPre10 && commitMatches) {
        summary = "Cashed Out 💰!";
        ok = true;
      } else if (strictOk) {
        summary = "✅ Verified. Your secret reproduces the exact on-chain outcome.";
        ok = true;
      } else if (!commitMatches) {
        summary = "❌ Not verified: secret → commit does not match stored on-chain userCommit.";
        ok = false;
      } else {
        summary = "❌ Not verified: one or more checks failed (hop / payout / win-bust).";
        ok = false;
      }

      if (ready) setStoredSecret(selectedChainId, gameAddress, gid, secret);

      const bundle = {
        chainId: selectedChainId,
        vault: seedVault,
        game: gameAddress,
        gameId: gid,
        userSecret: secret,
        cashoutHop: hop,
        txHash: isHex(txHash.trim()) ? txHash.trim() : undefined,
      };

      setResult({
        ok,
        summary,
        bundleJson: JSON.stringify(bundle, null, 2),
        chainId: selectedChainId,
        game: gameAddress,
        seedVault,
        gameId: gid,
        player,
        amountWei,
        amountDtc,
        mode,
        pBps,
        onchain: {
          userCommit: onUserCommit,
          randAnchor: onRandAnchor,
          settled,
          cashoutHop: rawOnHop,
          payoutWei: onPayoutWei,
          payoutDtc: onPayoutDtc,
        },
        computed: {
          commit,
          seed,
          won,
          payoutWei,
          payoutDtc,
          cashoutHop: hop,
          rolls,
        },
        comparisons: {
          commitMatches,
          payoutMatchesIfSettled,
          wonMatchesIfSettled,
          hopMatchesIfSettled,
          txPayoutMatches,
          txWonMatches,
          txHopMatches,
          txCommitMatches,
        },
      });
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  async function onSelectRecent(row: RecentGameRow) {
    setErr("");
    setResult(null);
    setFromTx(null);
    setTxParseStatus("");
    setSelectedRecentId(row.gameId);

    setGameId(row.gameId);
    setCashoutHop(row.settled && row.cashoutHop >= 1 ? clampHop(row.cashoutHop) : 1);

    if (ready && publicClient && canUseChain) {
      setRecentStatus("Finding tx…");
      const found = await findTxHashesForGame({
        publicClient,
        game: gameAddress,
        gameId: row.gameId,
      });

      setRecent((prev) =>
        prev.map((r) =>
          r.gameId.toLowerCase() === row.gameId.toLowerCase()
            ? { ...r, createTxHash: found.createTx, settleTxHash: found.settleTx }
            : r
        )
      );

      const bestTx = found.settleTx ?? found.createTx;
      if (bestTx) {
        setTxHash(bestTx);
        await tryAutofillFromTx(bestTx);
      } else {
        setTxHash("");
      }
      setRecentStatus("");
    }

    if (ready) {
      const s = getStoredSecret(selectedChainId, gameAddress, row.gameId);
      if (s) setUserSecret(s);
    }
  }

  function importBundle() {
    setBundleStatus("");
    setErr("");
    try {
      const raw = bundleText.trim();
      if (!raw) return setBundleStatus("Paste a JSON bundle first.");

      const obj = JSON.parse(raw) as any;
      const bChainId = Number(obj.chainId);
      const bGame = String(obj.game ?? "");
      const bGameId = String(obj.gameId ?? "");
      const bSecret = String(obj.userSecret ?? "");
      const bHop = Number(obj.cashoutHop ?? 1);
      const bTx = String(obj.txHash ?? "");

      if (!Number.isFinite(bChainId) || !TOKEN_CHAIN_IDS.includes(bChainId as any)) {
        return setBundleStatus("Bundle chainId must be Linea/Base.");
      }
      if (!isHex(bGame) || bGame.length !== 42) return setBundleStatus("Bundle game is invalid.");
      if (!isHex(bGameId) || bGameId.length !== 66) return setBundleStatus("Bundle gameId is invalid.");
      if (!isHex(bSecret) || bSecret.length !== 66) return setBundleStatus("Bundle userSecret is invalid.");

      setSelectedChainId(bChainId);

      if (defaultGame.toLowerCase() !== (bGame as Hex).toLowerCase()) {
        setGameOverride(bGame);
      }

      setGameId(bGameId);
      setUserSecret(bSecret);
      setCashoutHop(clampHop(bHop));
      setTxHash(isHex(bTx) ? bTx : "");

      if (ready) {
        setStoredSecret(bChainId, bGame as Hex, bGameId as Hex, bSecret as Hex);
      }

      setBundleStatus("Bundle imported and secret stored on this device.");
      window.setTimeout(() => setBundleStatus(""), 1500);
    } catch {
      setBundleStatus("Invalid JSON bundle.");
    }
  }

  const chainOptions = useMemo(() => CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any)), []);
  const displayGame = gameAddress === (zeroAddress as Hex) ? "—" : gameAddress;
  const displayVault = seedVault === (zeroAddress as Hex) ? "—" : seedVault;

  const resultHop = result?.computed.cashoutHop ?? 0;
  const resultSettled = result?.onchain.settled ?? false;
  const resultPayoutWei = result?.onchain.payoutWei ?? 0n;
  const showCashedOut = !!result && isCashedOutPre10(resultSettled, resultHop, resultPayoutWei);
  const showMaxHit = !!result && isMaxHitCashout(resultSettled, resultHop, resultPayoutWei);

  const chipLabel = !result
    ? "Awaiting input"
    : showMaxHit
    ? "MAX HIT"
    : showCashedOut
    ? "CASHED OUT"
    : result.ok
    ? "VERIFIED"
    : "NOT VERIFIED";

  const chipClasses = !result
    ? "bg-neutral-50/10 text-neutral-200 ring-neutral-200/20"
    : showMaxHit
    ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/25"
    : showCashedOut
    ? "bg-amber-500/10 text-amber-200 ring-amber-500/25"
    : result.ok
    ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/25"
    : "bg-red-500/10 text-red-200 ring-red-500/25";

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <style jsx global>{`
        @keyframes goldShine {
          0% {
            transform: translateX(-30%);
            opacity: 0;
          }
          35% {
            opacity: 0.9;
          }
          70% {
            opacity: 0.6;
          }
          100% {
            transform: translateX(130%);
            opacity: 0;
          }
        }
        @keyframes coinFloat {
          0% {
            transform: translateY(0px) rotate(0deg);
            opacity: 0;
          }
          15% {
            opacity: 0.9;
          }
          100% {
            transform: translateY(-34px) rotate(18deg);
            opacity: 0;
          }
        }
        @keyframes maxGlowPulse {
          0% {
            opacity: 0.35;
            transform: scale(1);
          }
          50% {
            opacity: 0.65;
            transform: scale(1.03);
          }
          100% {
            opacity: 0.35;
            transform: scale(1);
          }
        }
        @keyframes maxAuraDrift {
          0% {
            opacity: 0.18;
            transform: translateX(-10px) translateY(6px) scale(1);
          }
          50% {
            opacity: 0.34;
            transform: translateX(12px) translateY(-8px) scale(1.05);
          }
          100% {
            opacity: 0.18;
            transform: translateX(-10px) translateY(6px) scale(1);
          }
        }
        @keyframes maxEdgeShimmer {
          0% {
            opacity: 0;
            transform: translateX(-35%);
          }
          10% {
            opacity: 0.65;
          }
          40% {
            opacity: 0.35;
          }
          100% {
            opacity: 0;
            transform: translateX(135%);
          }
        }
      `}</style>

      <TopNav playMode={"demo" as any} setPlayMode={() => {}} soundOn={true} setSoundOn={() => {}} controlsLocked={false} />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Verify Fairness</h1>
              <p className="mt-2 text-neutral-300">
                Recompute hop rolls and payout from your <b>userSecret</b> + on-chain <b>randAnchor</b>.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Wallet chain:{" "}
              <span suppressHydrationWarning className="text-neutral-100">
                {ready && isConnected && walletChainId
                  ? CHAIN_LIST.find((c) => c.chainId === walletChainId)?.name ?? walletChainId
                  : "—"}
              </span>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-semibold text-neutral-100">Import verification bundle (recommended)</div>
            <div className="mt-1 text-[12px] text-neutral-500">
              Paste a JSON bundle exported from the Play page (includes userSecret). This enables verify even on a different device.
            </div>

            <textarea
              value={bundleText}
              onChange={(e) => setBundleText(e.target.value)}
              placeholder={`{\n  "chainId": 8453,\n  "vault": "0x…",\n  "game": "0x…",\n  "gameId": "0x…",\n  "userSecret": "0x…",\n  "cashoutHop": 3,\n  "txHash": "0x…"\n}`}
              className="mt-3 w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-100 outline-none font-mono"
              rows={6}
            />

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={importBundle}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
              >
                IMPORT BUNDLE
              </button>
              {bundleStatus ? <span className="text-xs text-neutral-400">{bundleStatus}</span> : null}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-semibold text-neutral-100">Network</div>
              <div className="flex flex-wrap gap-2">
                {chainOptions.map((c) => {
                  const active = c.chainId === selectedChainId;
                  const iconSrc = CHAIN_ICON[c.chainId] ?? "";

                  return (
                    <button
                      key={c.chainId}
                      type="button"
                      onClick={() => setSelectedChainId(c.chainId)}
                      className={[
                        "flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition",
                        active
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                      ].join(" ")}
                    >
                      {iconSrc ? <Image src={iconSrc} alt={`${c.name} icon`} width={16} height={16} className="h-4 w-4" /> : null}
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="text-xs text-neutral-500">
                Game (auto):{" "}
                <span className="font-mono text-neutral-200">{defaultGame === (zeroAddress as Hex) ? "—" : defaultGame}</span>
              </div>

              <div>
                <div className="text-xs text-neutral-400">Game override (optional)</div>
                <input
                  value={gameOverride}
                  onChange={(e) => setGameOverride(e.target.value)}
                  placeholder="0x… (42 chars)"
                  className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-50 outline-none font-mono"
                />
              </div>
            </div>

            <div className="mt-2 text-xs text-neutral-500">
              Using GAME: <span className="font-mono text-neutral-200">{displayGame}</span>
              {!canUseChain ? <span className="ml-2 text-amber-200">⚠️ Missing/invalid game address</span> : null}
            </div>

            <div className="mt-2 text-xs text-neutral-500">
              Seed VAULT (from GAME.VAULT()): <span className="font-mono text-neutral-200">{displayVault}</span>
              {seedVaultStatus ? <span className="ml-2 text-amber-200">⚠️ {seedVaultStatus}</span> : null}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">My recent games</div>
                <div className="mt-1 text-xs text-neutral-500">
                  IMPORTANT: Recent games are read from the GAME contract (getUserGamesLength/getUserGamesSlice).
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadMyRecentGames(10)}
                  disabled={!ready || recentLoading || !address || !canUseChain}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !ready || recentLoading || !address || !canUseChain
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  IMPORT LAST 10
                </button>

                <button
                  type="button"
                  onClick={() => void loadMyRecentGames(20)}
                  disabled={!ready || recentLoading || !address || !canUseChain}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                    !ready || recentLoading || !address || !canUseChain
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                  ].join(" ")}
                >
                  IMPORT LAST 20
                </button>
              </div>
            </div>

            {!ready ? (
              <div className="mt-3 text-xs text-neutral-500">Initializing…</div>
            ) : !address ? (
              <div className="mt-3 text-xs text-neutral-500">Connect your wallet to import your games.</div>
            ) : recentStatus ? (
              <div className="mt-3 text-xs text-neutral-400">{recentStatus}</div>
            ) : null}

            {recent.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800">
                <div className="grid grid-cols-[1fr_90px_110px_170px] bg-neutral-900/60 px-4 py-3 text-xs font-semibold text-neutral-300">
                  <div>Game</div>
                  <div className="text-center">Mode</div>
                  <div className="text-right">Amount</div>
                  <div className="text-right">Status</div>
                </div>

                <div className="divide-y divide-neutral-800">
                  {recent.map((r) => {
                    const st = getStatusKey(r, nowSec);
                    const active = selectedRecentId?.toLowerCase() === r.gameId.toLowerCase();
                    const bestTx = r.settleTxHash ?? r.createTxHash;

                    return (
                      <button
                        key={r.gameId}
                        type="button"
                        onClick={() => void onSelectRecent(r)}
                        className={[
                          "grid w-full grid-cols-[1fr_90px_110px_170px] px-4 py-3 text-left text-sm transition hover:bg-neutral-900/40",
                          active ? "bg-neutral-900/40" : "",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-neutral-100">{shortHex(r.gameId)}</div>
                          <div className="mt-1 text-[11px] text-neutral-600">
                            tx: <span className="font-mono text-neutral-300">{bestTx ? shortHex(bestTx) : "—"}</span>
                          </div>
                          {r.verify ? (
                            <div className="mt-1 text-[11px] text-neutral-600">
                              verify:{" "}
                              <span className="font-semibold text-neutral-300">
                                {r.verify.label}
                                {r.verify.detail ? <span className="text-neutral-500"> ({r.verify.detail})</span> : null}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="text-center font-semibold text-neutral-100">{r.mode}</div>

                        <div className="text-right text-neutral-100">
                          {Number(r.amountDtc).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <span className={["rounded-full px-2 py-0.5 text-xs font-semibold ring-1", statusChipClasses(st)].join(" ")}>
                            {st}
                          </span>

                          <span
                            className={[
                              "rounded-full px-2 py-0.5 text-xs font-extrabold ring-1",
                              verifyChipClasses(r.verify?.key ?? "NO_SECRET"),
                            ].join(" ")}
                          >
                            {r.verify?.label ?? "NO SECRET"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-neutral-600">Tip: select the correct network first (Linea/Base), then import.</div>
            )}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[420px_1fr]">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
              <div className="text-sm font-semibold text-neutral-100">Inputs</div>

              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-xs text-neutral-400">Tx hash</div>
                  <input
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    placeholder="auto-filled when possible"
                    className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-50 outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => void tryAutofillFromTx(txHash)}
                    disabled={!ready || !isHex(txHash.trim()) || txHash.trim().length !== 66}
                    className={[
                      "mt-2 w-full rounded-xl border px-4 py-2 text-xs font-extrabold transition",
                      !ready || !isHex(txHash.trim()) || txHash.trim().length !== 66
                        ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                        : "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60",
                    ].join(" ")}
                  >
                    PARSE TX
                  </button>
                  {txParseStatus ? <div className="mt-1 text-[11px] text-neutral-400">{txParseStatus}</div> : null}
                </div>

                <div>
                  <div className="text-xs text-neutral-400">Game ID</div>
                  <input
                    value={gameId}
                    onChange={(e) => setGameId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-50 outline-none font-mono"
                  />
                </div>

                <div>
                  <div className="text-xs text-neutral-400">User Secret</div>
                  <input
                    value={userSecret}
                    onChange={(e) => setUserSecret(e.target.value)}
                    placeholder="auto-filled only if stored on this device OR imported via bundle"
                    className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-50 outline-none font-mono"
                  />
                </div>

                <div>
                  <div className="text-xs text-neutral-400">Hop</div>
                  <input
                    value={String(cashoutHop)}
                    onChange={(e) => setCashoutHop(clampHop(parseInt(e.target.value || "1", 10)))}
                    className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-50 outline-none"
                  />
                </div>

                {err ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-200">{err}</div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void verifyNow()}
                  disabled={!ready || loading || !canUseChain || seedVault === (zeroAddress as Hex)}
                  className={[
                    "mt-2 w-full rounded-2xl px-4 py-3 text-sm font-extrabold tracking-wide transition",
                    !ready || loading || !canUseChain || seedVault === (zeroAddress as Hex)
                      ? "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500"
                      : "bg-emerald-500 text-neutral-950 hover:bg-emerald-400",
                  ].join(" ")}
                >
                  {loading ? "VERIFYING…" : "VERIFY"}
                </button>

                <div className="mt-2 text-[11px] text-neutral-600">
                  Secrets are stored locally by chain + GAME contract. For cross-device verification, use the bundle.
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-neutral-100">Result</div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Truth source: <span className="font-mono">{shortHex(gameAddress)}</span> (GAME) on <b>{selectedChain.name}</b>
                    <br />
                    Seed vault: <span className="font-mono">{shortHex(seedVault)}</span>
                  </div>
                </div>

                <span className={["rounded-full px-3 py-1 text-xs font-extrabold ring-1", chipClasses].join(" ")}>
                  {chipLabel}
                </span>
              </div>

              {!result ? (
                <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-300">
                  Select a game row, or import a bundle, then verify.
                </div>
              ) : (
                <>
                  <div className="relative mt-4 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
                    {showCashedOut ? (
                      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                        <div className="absolute inset-0 opacity-60">
                          <div
                            className="absolute -left-1/3 top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-amber-200/50 to-transparent"
                            style={{ animation: "goldShine 1.6s linear infinite" }}
                          />
                        </div>

                        <div className="relative flex items-center justify-between gap-4">
                          <div className="text-sm font-extrabold tracking-wide text-amber-100">Cashed Out 💰!</div>
                          <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                            Hop {result.computed.cashoutHop}/10 •{" "}
                            {Number(result.onchain.payoutDtc).toLocaleString("en-US", { maximumFractionDigits: 6 })} DTC
                          </div>
                        </div>

                        <div className="pointer-events-none absolute inset-0">
                          {Array.from({ length: 10 }).map((_, i) => (
                            <span
                              key={i}
                              className="absolute text-lg"
                              style={{
                                left: `${6 + i * 9}%`,
                                bottom: `-6px`,
                                animation: `coinFloat ${1.1 + (i % 4) * 0.1}s ease-out infinite`,
                                animationDelay: `${(i % 6) * 0.12}s`,
                                filter: "drop-shadow(0 0 8px rgba(251, 191, 36, 0.35))",
                              }}
                              aria-hidden
                            >
                              🪙
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : showMaxHit ? (
                      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                        <div className="absolute inset-0 opacity-70">
                          <div
                            className="absolute -left-1/3 top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-amber-200/45 to-transparent"
                            style={{ animation: "goldShine 1.35s linear infinite" }}
                          />
                        </div>

                        <div className="pointer-events-none absolute inset-0">
                          <div
                            className="absolute left-1/2 top-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                            style={{
                              background:
                                "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.35), rgba(52,211,153,0.20) 40%, rgba(251,191,36,0.12) 70%, rgba(0,0,0,0) 74%)",
                              filter:
                                "blur(2px) drop-shadow(0 0 18px rgba(52, 211, 153, 0.20)) drop-shadow(0 0 22px rgba(251, 191, 36, 0.16))",
                              animation: "maxGlowPulse 1.05s ease-in-out infinite",
                            }}
                            aria-hidden
                          />
                          <div
                            className="absolute -left-10 -top-8 h-40 w-64 rounded-full"
                            style={{
                              background: "radial-gradient(circle at 35% 40%, rgba(52,211,153,0.28), rgba(0,0,0,0) 68%)",
                              filter: "blur(10px)",
                              animation: "maxAuraDrift 1.7s ease-in-out infinite",
                            }}
                            aria-hidden
                          />
                          <div
                            className="absolute -right-16 -bottom-10 h-44 w-72 rounded-full"
                            style={{
                              background: "radial-gradient(circle at 55% 45%, rgba(251,191,36,0.22), rgba(0,0,0,0) 70%)",
                              filter: "blur(12px)",
                              animation: "maxAuraDrift 1.9s ease-in-out infinite",
                            }}
                            aria-hidden
                          />
                          <div
                            className="absolute -left-1/3 top-0 h-full w-1/2"
                            style={{
                              background:
                                "linear-gradient(90deg, rgba(0,0,0,0), rgba(255,255,255,0.22), rgba(52,211,153,0.14), rgba(251,191,36,0.10), rgba(0,0,0,0))",
                              filter: "blur(1px)",
                              animation: "maxEdgeShimmer 1.25s ease-in-out infinite",
                            }}
                            aria-hidden
                          />
                        </div>

                        <div className="relative flex items-center justify-between gap-4">
                          <div className="text-sm font-extrabold tracking-wide text-emerald-100">⚡ MAX HIT CASHOUT! 🏆💰</div>
                          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
                            Hop 10/10 •{" "}
                            {Number(result.onchain.payoutDtc).toLocaleString("en-US", { maximumFractionDigits: 6 })} DTC
                          </div>
                        </div>

                        <div className="relative mt-2 text-[11px] text-amber-200/80">Legendary run.</div>
                      </div>
                    ) : (
                      <div
                        className={[
                          "rounded-2xl border p-4 text-sm",
                          result.ok
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                            : "border-red-500/20 bg-red-500/10 text-red-100",
                        ].join(" ")}
                      >
                        {result.summary}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-neutral-200">Verification Bundle</div>
                      <button
                        type="button"
                        onClick={async () => {
                          await copyText(result.bundleJson);
                        }}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                      >
                        COPY JSON
                      </button>
                    </div>
                    <pre className="mt-3 max-h-64 overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-200">
                      {result.bundleJson}
                    </pre>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-6 text-xs text-neutral-600">
            Integrity model: secret stays private. Verification uses GAME.games(gameId) + GAME.VAULT() (seed vault).
          </div>
        </div>
      </section>
    </main>
  );
}
