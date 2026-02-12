// app/play/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import TopNav from "../components/TopNav";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import OutcomeBoard from "../components/OutcomeBoard";
import ApprovalToggle from "../components/ApprovalToggle";

import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWriteContract,
  usePublicClient,
} from "wagmi";

import { ERC20_ABI } from "../lib/abi/erc20";
import type { ApprovalPolicy } from "../lib/approvalPolicy";

import {
  parseUnits,
  formatUnits,
  keccak256,
  encodePacked,
  type Hex,
  zeroAddress,
  decodeEventLog,
  isHex,
} from "viem";

type ModeKey = "safe" | "wild" | "insane";

const MAX_HOPS = 10;

// IMPORTANT: Liquidity protection
const MAX_AMOUNT = 12_000; // ALWAYS 12,000
const MIN_AMOUNT = 1;

// ✅ Supported TOKEN-mode chains (Linea + Base)
const TOKEN_CHAIN_IDS = [59144, 8453] as const;
type TokenChainId = (typeof TOKEN_CHAIN_IDS)[number];
function isTokenChain(id: number | undefined): id is TokenChainId {
  return !!id && TOKEN_CHAIN_IDS.includes(id as TokenChainId);
}

/**
 * ✅ CONTRACT CONFIG (FIXED)
 * - Spender for approvals must be the GAME contract (it calls transferFrom).
 * - createGame / cashOut are on the GAME contract (LilypadLeapGame).
 */
const DTC_BY_CHAIN: Record<number, Hex> = {
  // Linea
  59144: "0xEb1fD1dBB8aDDA4fa2b5A5C4bcE34F6F20d125D2",
  // Base (keep whatever you already use in your app if different)
  // If your Base DTC differs, replace it here.
  8453: "0xFbA669C72b588439B29F050b93500D8b645F9354", // 
};

const VAULT_BY_CHAIN: Record<number, Hex> = {
  // Linea
  59144: "0xF4Bf262565e0Cc891857DF08Fe55de5316d0Db45",
  // Base
  8453: "0x2C853B5a06A1F6C3A0aF4c1627993150c6585eb3",
};

const GAME_BY_CHAIN: Record<number, Hex> = {
  // Linea
  59144: "0x71dF04f70b87994C4cB2a69A735D821169fE7148",
  // Base
  8453: "0x7f4EAc0BDBeF0b782ff57E6897112DB9D31E6AB3",
};

// ✅ LilypadLeapGame ABI (as provided by you)
const LILYPAD_LEAP_GAME_ABI = [
  {
    inputs: [{ internalType: "address", name: "vault", type: "address" }],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  { inputs: [], name: "ReentrancyGuardReentrantCall", type: "error" },
  {
    inputs: [{ internalType: "address", name: "token", type: "address" }],
    name: "SafeERC20FailedOperation",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "gameId", type: "bytes32" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "uint256", name: "amountReceived", type: "uint256" },
      { indexed: false, internalType: "enum LilypadLeapGame.Mode", name: "mode", type: "uint8" },
      { indexed: false, internalType: "bytes32", name: "userCommit", type: "bytes32" },
      { indexed: false, internalType: "bytes32", name: "randAnchor", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "createdAt", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "deadline", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "maxPayoutReserved", type: "uint256" },
    ],
    name: "GameCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "gameId", type: "bytes32" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
    ],
    name: "GameExpired",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "gameId", type: "bytes32" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
    ],
    name: "GameForfeited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "gameId", type: "bytes32" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "bool", name: "won", type: "bool" },
      { indexed: false, internalType: "uint8", name: "cashoutHop", type: "uint8" },
      { indexed: false, internalType: "uint256", name: "payout", type: "uint256" },
      { indexed: false, internalType: "bytes32", name: "userCommitHash", type: "bytes32" },
      { indexed: false, internalType: "bytes32", name: "randAnchor", type: "bytes32" },
    ],
    name: "GameSettled",
    type: "event",
  },
  {
    inputs: [],
    name: "DEADLINE_SECONDS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_BET",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_HOPS",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MIN_BET",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "TOKEN",
    outputs: [{ internalType: "contract IERC20", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "VAULT",
    outputs: [{ internalType: "contract ToadArcadeVaultDTC", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "gameId", type: "bytes32" },
      { internalType: "bytes32", name: "userSecret", type: "bytes32" },
      { internalType: "uint8", name: "cashoutHop", type: "uint8" },
    ],
    name: "cashOut",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "enum LilypadLeapGame.Mode", name: "mode", type: "uint8" },
      { internalType: "bytes32", name: "userCommit", type: "bytes32" },
    ],
    name: "createGame",
    outputs: [{ internalType: "bytes32", name: "gameId", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "gameId", type: "bytes32" }],
    name: "expire",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "games",
    outputs: [
      { internalType: "address", name: "player", type: "address" },
      { internalType: "uint128", name: "amount", type: "uint128" },
      { internalType: "uint40", name: "createdAt", type: "uint40" },
      { internalType: "uint40", name: "deadline", type: "uint40" },
      { internalType: "enum LilypadLeapGame.Mode", name: "mode", type: "uint8" },
      { internalType: "bytes32", name: "userCommit", type: "bytes32" },
      { internalType: "bytes32", name: "randAnchor", type: "bytes32" },
      { internalType: "bool", name: "settled", type: "bool" },
      { internalType: "uint8", name: "cashoutHop", type: "uint8" },
      { internalType: "uint128", name: "payout", type: "uint128" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getUserGamesLength",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "uint256", name: "start", type: "uint256" },
      { internalType: "uint256", name: "count", type: "uint256" },
    ],
    name: "getUserGamesSlice",
    outputs: [{ internalType: "bytes32[]", name: "ids", type: "bytes32[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "openGameOf",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "userGames",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Sound files (served from /public)
const SOUND_BASE = "/lilypad-leap/sounds";
type SoundKey = "start" | "hop" | "busted" | "cashout" | "maxhit" | "win";
const SOUND_SRC: Record<SoundKey, string> = {
  start: `${SOUND_BASE}/start.mp3`,
  hop: `${SOUND_BASE}/hop.mp3`,
  busted: `${SOUND_BASE}/busted.mp3`,
  cashout: `${SOUND_BASE}/cashout.mp3`,
  maxhit: `${SOUND_BASE}/maxhit.mp3`,
  win: `${SOUND_BASE}/win.mp3`,
};

// Fixed per-hop success + fixed payout tables (approved)
const MODE: Record<
  ModeKey,
  {
    key: ModeKey;
    label: string;
    subtitle: string;
    pStep: number; // 0..1 (fixed per hop)
    mults: number[]; // hop 1..10 cashout multipliers
  }
> = {
  safe: {
    key: "safe",
    label: "🛡️ SAFE",
    subtitle: "Smoother curve. Lower variance.",
    pStep: 0.9,
    mults: [1.04, 1.16, 1.28, 1.43, 1.59, 1.76, 1.96, 2.18, 2.42, 2.69],
  },
  wild: {
    key: "wild",
    label: "😎 WILD",
    subtitle: "Balanced risk. Faster growth.",
    pStep: 0.82,
    mults: [1.11, 1.35, 1.65, 2.01, 2.45, 2.99, 3.64, 4.44, 5.41, 6.0],
  },
  insane: {
    key: "insane",
    label: "🐸 DEGEN",
    subtitle: "High risk. Fast multipliers.",
    pStep: 0.69,
    mults: [1.2, 1.64, 2.24, 3.06, 4.19, 5.73, 7.83, 10.7, 14.63, 20.0],
  },
};

// --- Deterministic RNG (xorshift32) ---
function xorshift32(x: number) {
  let y = x >>> 0;
  y ^= y << 13;
  y >>>= 0;
  y ^= y >>> 17;
  y >>>= 0;
  y ^= y << 5;
  y >>>= 0;
  return y >>> 0;
}

// Convert uint32 -> roll in [0,100)
function uint32ToRoll(u: number) {
  const r = (u / 0xffffffff) * 100;
  return Math.max(0, Math.min(99.999, r));
}

function formatRoll(v: number | null) {
  if (v === null) return "—";
  return v.toFixed(3);
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function fmtInt(n: number) {
  return n.toLocaleString("en-US");
}

function fmtX(n: number) {
  return `${n.toFixed(2)}x`;
}

function ceilPercent(pct: number) {
  return `${Math.ceil(pct)}%`;
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
    />
  );
}

// DTC icon (served from your assets repo via jsdelivr)
const DTC_ICON_SRC = "https://cdn.jsdelivr.net/gh/DonaldToad/dtc-assets@main/dtc-32.svg";

function DtcIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      src={DTC_ICON_SRC}
      alt="DTC"
      width={size}
      height={size}
      className="inline-block align-[-2px]"
      loading="lazy"
      decoding="async"
    />
  );
}

// Build a deterministic 32-byte-ish hex "commit hash" from a uint32 state (DEMO placeholder)
function buildCommitHash(seed: number) {
  let s = seed >>> 0;
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    s = xorshift32(s);
    parts.push(s.toString(16).padStart(8, "0"));
  }
  return `0x${parts.join("")}`;
}

function truncateHashFirstLast(h: string) {
  if (!h) return "—";
  if (h.length <= 24) return h;
  const first = h.slice(0, 12);
  const last = h.slice(-10);
  return `${first}…${last}`;
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

function bytesToHex(bytes: Uint8Array): Hex {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex as Hex;
}

function randomSecret32(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

type Outcome = "idle" | "success" | "bust" | "cashout" | "maxhit";
type AnimEvent = "idle" | "hop_ok" | "hop_fail" | "cash_out" | "max_hit";

/**
 * ✅ Local storage for secrets (so /verify can load them on same device)
 * key: `${chainId}:${game}:${gameId}` -> userSecret
 */
const SECRET_STORE_KEY = "lilypadLeapSecretsV2";
function secretStoreKey(chainId: number, game: Hex, gameId: Hex) {
  return `${chainId}:${game.toLowerCase()}:${gameId.toLowerCase()}`;
}
function setStoredSecret(chainId: number, game: Hex, gameId: Hex, userSecret: Hex) {
  try {
    const raw = localStorage.getItem(SECRET_STORE_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    obj[secretStoreKey(chainId, game, gameId)] = userSecret;
    localStorage.setItem(SECRET_STORE_KEY, JSON.stringify(obj));
  } catch {}
}

/**
 * ✅ Shareable bundle (paste into /verify)
 */
function buildVerifyBundle(params: {
  chainId: number;
  vault: Hex;
  game: Hex;
  gameId: Hex;
  userSecret: Hex;
  cashoutHop?: number;
  createTxHash?: Hex;
}) {
  const b = {
    chainId: params.chainId,
    vault: params.vault,
    game: params.game,
    gameId: params.gameId,
    userSecret: params.userSecret,
    cashoutHop: params.cashoutHop ?? 1,
    txHash: params.createTxHash,
  };
  return JSON.stringify(b, null, 2);
}

export default function PlayPage() {
  // Prevent hydration mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // -----------------------------
  // Sounds
  // -----------------------------
  const [soundOn, setSoundOn] = useState<boolean>(true);
  const soundsRef = useRef<Record<SoundKey, HTMLAudioElement> | null>(null);
  const winTimerRef = useRef<number | null>(null);

  function stopAllSounds() {
    const bank = soundsRef.current;
    if (!bank) return;
    (Object.keys(bank) as SoundKey[]).forEach((k) => {
      try {
        bank[k].pause();
        bank[k].currentTime = 0;
      } catch {}
    });
  }

  function playSound(key: SoundKey, opts?: { restart?: boolean }) {
    if (!soundOn) return;
    const bank = soundsRef.current;
    if (!bank) return;
    const a = bank[key];
    if (!a) return;

    try {
      if (opts?.restart !== false) a.currentTime = 0;
      const p = a.play();
      if (p && typeof (p as any).catch === "function") (p as Promise<void>).catch(() => {});
    } catch {}
  }

  useEffect(() => {
    try {
      const bank: Record<SoundKey, HTMLAudioElement> = {
        start: new Audio(SOUND_SRC.start),
        hop: new Audio(SOUND_SRC.hop),
        busted: new Audio(SOUND_SRC.busted),
        cashout: new Audio(SOUND_SRC.cashout),
        maxhit: new Audio(SOUND_SRC.maxhit),
        win: new Audio(SOUND_SRC.win),
      };
      (Object.keys(bank) as SoundKey[]).forEach((k) => {
        bank[k].preload = "auto";
        bank[k].volume = 0.9;
      });
      soundsRef.current = bank;
    } catch {
      soundsRef.current = null;
    }

    return () => {
      if (winTimerRef.current) window.clearTimeout(winTimerRef.current);
      winTimerRef.current = null;
      try {
        stopAllSounds();
      } catch {}
      soundsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!soundOn) stopAllSounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn]);

  // -----------------------------
  // Wallet + Chain
  // -----------------------------
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: connectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const safeIsConnected = mounted ? isConnected : false;
  const safeAddress = mounted ? address : undefined;
  const safeChainId = mounted ? chainId : undefined;
  const safeConnectPending = mounted ? connectPending : false;
  const safeConnectors = mounted ? connectors : [];

  // Chain selection (UI-only)
  const [selectedChainKey, setSelectedChainKey] = useState<string>(PRIMARY_CHAIN.key);
  const selectedChain = CHAIN_LIST.find((c) => c.key === selectedChainKey) ?? PRIMARY_CHAIN;

  type PlayMode = "demo" | "token";
  const [playMode, setPlayMode] = useState<PlayMode>("demo");

  const tokenChainOk = mounted && safeIsConnected && isTokenChain(safeChainId);
  const isWrongNetwork = mounted && safeIsConnected && playMode === "token" && !tokenChainOk;

  // ✅ Effective chain for READS
  const effectiveChainId =
    playMode === "token" && tokenChainOk ? (safeChainId as number) : selectedChain.chainId;

  const tokenAddress = (DTC_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  const vaultAddress = (VAULT_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  const gameAddress = (GAME_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;

  // If wallet disconnects, force demo.
  useEffect(() => {
    if (!safeIsConnected) setPlayMode("demo");
  }, [safeIsConnected]);

  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>({ kind: "unlimited" });
  const approveCapDtc = approvalPolicy.kind === "limited" ? approvalPolicy.capDtc : MAX_AMOUNT;

  const [txStatus, setTxStatus] = useState<string>("");
  const [txError, setTxError] = useState<string>("");

  const [startPending, setStartPending] = useState<boolean>(false);
  const [cashOutPending, setCashOutPending] = useState<boolean>(false);

  const [activeGameId, setActiveGameId] = useState<Hex | null>(null);
  const [activeUserSecret, setActiveUserSecret] = useState<Hex | null>(null);
  const [activeRandAnchor, setActiveRandAnchor] = useState<Hex | null>(null);
  const [settledPayoutWei, setSettledPayoutWei] = useState<bigint | null>(null);
  const [settledWon, setSettledWon] = useState<boolean | null>(null);

  // ✅ verification bundle (copy/paste into /verify)
  const [verifyBundle, setVerifyBundle] = useState<string>("");
  const [verifyBundleCopied, setVerifyBundleCopied] = useState<boolean>(false);

  // Mode selection
  const [modeKey, setModeKey] = useState<ModeKey>("safe");
  const mode = MODE[modeKey];

  // Amount input
  const [amount, setAmount] = useState<number>(1000);
  const [amountRaw, setAmountRaw] = useState<string>("1000");
  const [maxClampNotice, setMaxClampNotice] = useState<boolean>(false);

  // Run lifecycle
  const [hasStarted, setHasStarted] = useState<boolean>(false);
  const [hops, setHops] = useState<number>(0);
  const [currentMult, setCurrentMult] = useState<number>(1.0);
  const [isFailed, setIsFailed] = useState<boolean>(false);
  const [isCashedOut, setIsCashedOut] = useState<boolean>(false);

  // ✅ RNG state MUST be SSR-stable
  const [rngState, setRngState] = useState<number>(0x6a41f7f5);
  useEffect(() => {
    if (!mounted) return;
    setRngState((Date.now() ^ 0x6a41f7f5) >>> 0);
  }, [mounted]);

  // Commit hash (demo placeholder)
  const commitHash = useMemo(() => buildCommitHash(rngState), [rngState]);
  const [commitExpanded, setCommitExpanded] = useState(false);
  const [commitCopied, setCommitCopied] = useState(false);

  // Last attempt info
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [lastAttemptHop, setLastAttemptHop] = useState<number | null>(null);
  const [lastRequiredPct, setLastRequiredPct] = useState<number | null>(null);

  // Visual FX
  const [poppedHop, setPoppedHop] = useState<number | null>(null);
  const [failFlash, setFailFlash] = useState<boolean>(false);
  const [hopPulse, setHopPulse] = useState<boolean>(false);

  // Outcome banner
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [outcomeText, setOutcomeText] = useState<string>("");

  // Animation hooks
  const [animEvent, setAnimEvent] = useState<AnimEvent>("idle");
  const [animNonce, setAnimNonce] = useState<number>(0);

  // Action lock
  const [actionLocked, setActionLocked] = useState<boolean>(false);
  const lockTimerRef = useRef<number | null>(null);

  // Table expansion
  const [showAllSteps, setShowAllSteps] = useState<boolean>(true);

  // Scroll helper refs
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);

  const modeScrollRef = useRef<HTMLDivElement | null>(null);
  const didAutoScrollModeRef = useRef<boolean>(false);

  const lastStartedAmountRef = useRef<number>(1000);

  const multTable = useMemo(() => mode.mults, [modeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const stepSuccessPctExact = useMemo(() => mode.pStep * 100, [mode.pStep]);

  // -----------------------------
  // ✅ TOKEN MODE deterministic seed (MATHEMATICALLY EXACT)
  // IMPORTANT FIX:
  // Use GAME contract address (NOT vault) in the seed — this is what makes UI match on-chain,
  // and fixes "I reached 10 hops but chain says busted / payout 0".
  //
  // seed = keccak256(abi.encodePacked(userSecret, randAnchor, gameAddress, gameId))
  // hop roll = uint256(keccak256(abi.encodePacked(seed, hopNo))) % 10000
  // success if roll < pBps
  // -----------------------------
  const tokenSeed = useMemo(() => {
    if (playMode !== "token") return null;
    if (!activeUserSecret || !activeGameId || !activeRandAnchor) return null;
    if (gameAddress === zeroAddress) return null;

    return keccak256(
      encodePacked(
        ["bytes32", "bytes32", "address", "bytes32"],
        [activeUserSecret, activeRandAnchor, gameAddress, activeGameId]
      )
    ) as Hex;
  }, [playMode, activeUserSecret, activeGameId, activeRandAnchor, gameAddress]);

  const nextHopIndex = hops;
  const nextHopNo = hops + 1;

  // -----------------------------
  // Token mode accounting (18 decimals)
  // -----------------------------
  const amountWei = useMemo(() => {
    try {
      return parseUnits(String(Math.max(0, Math.floor(amount))), 18);
    } catch {
      return 0n;
    }
  }, [amount]);

  const approvalTargetWei = useMemo(() => {
    if (approvalPolicy.kind === "unlimited") return 2n ** 256n - 1n;
    return parseUnits(String(Math.max(1, Math.floor(approveCapDtc))), 18);
  }, [approvalPolicy, approveCapDtc]);

  /**
   * ✅ Allowance spender MUST be the GAME contract
   */
  const { data: allowanceWei, refetch: refetchAllowance } = useReadContract({
    chainId: effectiveChainId,
    abi: ERC20_ABI,
    address: tokenAddress,
    functionName: "allowance",
    args:
      safeAddress && gameAddress !== zeroAddress
        ? [safeAddress, gameAddress]
        : [zeroAddress, zeroAddress],
    query: {
      enabled:
        mounted &&
        safeIsConnected &&
        !!safeAddress &&
        tokenAddress !== zeroAddress &&
        gameAddress !== zeroAddress &&
        (playMode === "demo" || tokenChainOk),
    },
  });

  // ✅ Read DTC balance
  const { data: balanceWei, refetch: refetchBalance, isFetching: balanceFetching } = useReadContract({
    chainId: effectiveChainId,
    abi: ERC20_ABI,
    address: tokenAddress,
    functionName: "balanceOf",
    args: safeAddress ? [safeAddress] : [zeroAddress],
    query: {
      enabled:
        mounted &&
        safeIsConnected &&
        !!safeAddress &&
        tokenAddress !== zeroAddress &&
        (playMode === "demo" || tokenChainOk),
    },
  });

  const balanceDtc = useMemo(() => {
    if (!balanceWei) return null;
    try {
      return Number(formatUnits(balanceWei, 18));
    } catch {
      return null;
    }
  }, [balanceWei]);

  const balanceLabel = useMemo(() => {
    if (!mounted) return "—";
    if (!safeIsConnected || !safeAddress) return "—";
    if (playMode === "token" && !tokenChainOk) return "Wrong network";
    if (tokenAddress === zeroAddress) return "—";
    if (balanceFetching) return "Loading…";
    if (balanceDtc === null) return "—";
    return balanceDtc.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }, [mounted, safeIsConnected, safeAddress, playMode, tokenChainOk, tokenAddress, balanceFetching, balanceDtc]);

  const hasEnoughAllowance = useMemo(() => {
    const a = allowanceWei ?? 0n;
    return a >= amountWei;
  }, [allowanceWei, amountWei]);

  const maxHit = hasStarted && !isFailed && hops >= MAX_HOPS;
  const ended = isFailed || isCashedOut;

  const canStart = useMemo(() => {
    if (hasStarted) return false;
    if (startPending) return false;
    if (cashOutPending) return false;
    if (amount < MIN_AMOUNT) return false;

    if (playMode === "demo") return true;

    if (!mounted) return false;
    if (!safeIsConnected || !safeAddress) return false;
    if (!tokenChainOk) return false;

    // Must have addresses
    if (tokenAddress === zeroAddress || gameAddress === zeroAddress || vaultAddress === zeroAddress) return false;

    return hasEnoughAllowance;
  }, [
    hasStarted,
    startPending,
    cashOutPending,
    amount,
    playMode,
    mounted,
    safeIsConnected,
    safeAddress,
    tokenChainOk,
    tokenAddress,
    gameAddress,
    vaultAddress,
    hasEnoughAllowance,
  ]);

  const canHop = hasStarted && !isFailed && !isCashedOut && !cashOutPending && !actionLocked && hops < MAX_HOPS;
  const canCashOut = hasStarted && !isFailed && !isCashedOut && !cashOutPending && !actionLocked && hops > 0;

  const currentReturn = useMemo(() => Math.floor(amount * currentMult), [amount, currentMult]);

  const nextHopSuccessExact = useMemo(() => {
    if (!canHop) return null;
    return stepSuccessPctExact;
  }, [canHop, stepSuccessPctExact]);

  // Default table behavior
  useEffect(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 900;
    setShowAllSteps(!isMobile);
  }, []);

  useEffect(() => {
    return () => {
      if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;

      if (winTimerRef.current) window.clearTimeout(winTimerRef.current);
      winTimerRef.current = null;
    };
  }, []);

  function lockActions(ms: number) {
    if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;

    if (ms <= 0) {
      setActionLocked(false);
      return;
    }

    setActionLocked(true);
    lockTimerRef.current = window.setTimeout(() => {
      setActionLocked(false);
      lockTimerRef.current = null;
    }, ms);
  }

  // -----------------------------
  // ✅ Robust scroll helpers (mobile safe)
  // -----------------------------
  const isMobileNow = () => (typeof window !== "undefined" ? window.innerWidth < 900 : false);

  const scrollToRefTop = useCallback((ref: { current: HTMLElement | null }, offset = 84) => {
    const el = ref.current;
    if (!el) return false;
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    return true;
  }, []);

  const scrollToRefTopWithRetry = useCallback(
    (ref: { current: HTMLElement | null }, opts?: { offset?: number; tries?: number; delayMs?: number }) => {
      const offset = opts?.offset ?? 84;
      const tries = opts?.tries ?? 10;
      const delayMs = opts?.delayMs ?? 120;

      if (typeof window === "undefined") return;
      if (!isMobileNow()) return;

      let attempt = 0;
      const tick = () => {
        attempt += 1;

        window.requestAnimationFrame(() => {
          const ok = scrollToRefTop(ref, offset);
          if (ok) return;

          if (attempt < tries) {
            window.setTimeout(tick, delayMs);
          }
        });
      };

      window.setTimeout(tick, 80);
    },
    [scrollToRefTop]
  );

  function scrollToBoard() {
    if (!isMobileNow()) return;
    scrollToRefTopWithRetry(boardScrollRef as any, { offset: 96, tries: 10, delayMs: 140 });
  }

  function scrollToMode() {
    if (!isMobileNow()) return;
    scrollToRefTopWithRetry(modeScrollRef as any, { offset: 96, tries: 10, delayMs: 140 });
  }

  // ✅ Auto-scroll to MODE on mobile on first paint (reliable)
  useEffect(() => {
    if (!mounted) return;
    if (didAutoScrollModeRef.current) return;
    if (hasStarted) return;
    if (!isMobileNow()) return;

    didAutoScrollModeRef.current = true;
    scrollToMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  function triggerAnim(ev: AnimEvent) {
    setAnimEvent(ev);
    setAnimNonce((n) => n + 1);

    const ms =
      ev === "hop_ok"
        ? 260
        : ev === "hop_fail"
        ? 520
        : ev === "cash_out"
        ? 520
        : ev === "max_hit"
        ? 680
        : 0;

    lockActions(ms);
  }

  function resetRunNewSeed() {
    if (winTimerRef.current) window.clearTimeout(winTimerRef.current);
    winTimerRef.current = null;

    const newSeed = ((Date.now() ^ 0x9e3779b9) >>> 0) as number;
    setRngState(newSeed);

    setHasStarted(false);
    setHops(0);
    setCurrentMult(1.0);
    setIsFailed(false);
    setIsCashedOut(false);

    setCashOutPending(false);

    setLastRoll(null);
    setLastAttemptHop(null);
    setLastRequiredPct(null);

    setPoppedHop(null);
    setFailFlash(false);
    setHopPulse(false);

    setOutcome("idle");
    setOutcomeText("");

    setCommitExpanded(false);
    setCommitCopied(false);

    setAnimEvent("idle");
    setAnimNonce((n) => n + 1);

    lockActions(0);

    // clear game-specific states
    setActiveGameId(null);
    setActiveUserSecret(null);
    setActiveRandAnchor(null);
    setSettledPayoutWei(null);
    setSettledWon(null);

    setVerifyBundle("");
    setVerifyBundleCopied(false);

    setTxStatus("");
    setTxError("");
  }

  // "PLAY AGAIN" uses previous started amount, and starts immediately
  function playAgainSameAmount() {
    const v = clampInt(lastStartedAmountRef.current || amount, MIN_AMOUNT, MAX_AMOUNT);
    setAmount(v);
    setAmountRaw(String(v));
    resetRunNewSeed();
    window.setTimeout(() => {
      void startRun();
    }, 0);
  }

  // "CHANGE AMOUNT" ends the run but preserves the last used amount in input for editing
  function changeAmountFlow() {
    resetRunNewSeed();
    window.setTimeout(() => scrollToMode(), 80);
  }

  function sanitizeAndSetAmount(nextRaw: string) {
    if (hasStarted || startPending || cashOutPending) return;

    const cleaned = nextRaw.replace(/[^\d]/g, "");
    setAmountRaw(cleaned);

    if (!cleaned.length) {
      setAmount(0);
      return;
    }

    const parsed = parseInt(cleaned, 10);
    const clamped = clampInt(parsed, MIN_AMOUNT, MAX_AMOUNT);

    if (parsed > MAX_AMOUNT) {
      setMaxClampNotice(true);
      window.setTimeout(() => setMaxClampNotice(false), 1400);
    }

    setAmount(clamped);
    setAmountRaw(String(clamped));
  }

  function setAmountPreset(v: number) {
    if (hasStarted || startPending || cashOutPending) return;
    const clamped = clampInt(v, MIN_AMOUNT, MAX_AMOUNT);
    setAmount(clamped);
    setAmountRaw(String(clamped));
  }

  async function approveNow() {
    if (!mounted) return;
    if (!safeIsConnected || !safeAddress) return;

    // ✅ Hard gate: no approvals off Linea/Base
    if (!tokenChainOk) {
      setTxError("Wrong network. Switch to Linea or Base.");
      return;
    }
    if (tokenAddress === zeroAddress) {
      setTxError("Token address not set in this file. (Set tokenAddress mapping or re-import your DTC_BY_CHAIN.)");
      return;
    }
    if (gameAddress === zeroAddress) {
      setTxError("Missing LilypadLeapGame address for this chain.");
      return;
    }

    try {
      if (!publicClient) throw new Error("No public client");
      setTxError("");
      setTxStatus("Approving DTC…");

      const hash = await writeContractAsync({
        chainId: safeChainId as number,
        abi: ERC20_ABI,
        address: tokenAddress,
        functionName: "approve",
        args: [gameAddress, approvalTargetWei],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      await refetchAllowance();
      try {
        await refetchBalance();
      } catch {}
      setTxStatus("Approved.");
      window.setTimeout(() => setTxStatus(""), 1200);
    } catch (e: any) {
      setTxStatus("");
      setTxError(e?.shortMessage || e?.message || "Approve failed");
    }
  }

  async function startRun() {
    if (!canStart) return;
    if (startPending) return;
    setStartPending(true);

    const clamped = clampInt(amount || MIN_AMOUNT, MIN_AMOUNT, MAX_AMOUNT);
    setAmount(clamped);
    setAmountRaw(String(clamped));
    lastStartedAmountRef.current = clamped;

    setActiveGameId(null);
    setActiveUserSecret(null);
    setActiveRandAnchor(null);
    setSettledPayoutWei(null);
    setSettledWon(null);

    setVerifyBundle("");
    setVerifyBundleCopied(false);

    setTxError("");
    setCashOutPending(false);

    if (playMode === "demo") {
      setHasStarted(true);
      setOutcome("idle");
      setOutcomeText("");

      playSound("start");
      window.setTimeout(() => scrollToBoard(), 120);

      setStartPending(false);
      return;
    }

    // TOKEN MODE: createGame() at START (on GAME contract)
    if (!mounted || !safeIsConnected || !safeAddress) {
      setTxError("Connect your wallet first.");
      setStartPending(false);
      return;
    }
    if (!tokenChainOk) {
      setTxError("Wrong network. Switch to Linea or Base.");
      setStartPending(false);
      return;
    }

    try {
      if (!publicClient) throw new Error("No public client");
      if (gameAddress === zeroAddress) throw new Error("Missing LilypadLeapGame address for this chain.");
      if (vaultAddress === zeroAddress) throw new Error("Missing ToadArcadeVault address for this chain.");

      const userSecret = randomSecret32();
      const userCommit = keccak256(encodePacked(["bytes32"], [userSecret])); // exact: keccak256(abi.encodePacked(userSecret))

      setActiveUserSecret(userSecret);

      // Use secret as a UX seed (purely for animation/demo rolls)
      const seed32 = Number(BigInt(userSecret) & 0xffffffffn);
      setRngState((seed32 >>> 0) as number);

      const modeEnum = modeKey === "safe" ? 0 : modeKey === "wild" ? 1 : 2;

      setTxStatus("Confirm in wallet…");

      const hash = await writeContractAsync({
        chainId: safeChainId as number,
        abi: LILYPAD_LEAP_GAME_ABI,
        address: gameAddress,
        functionName: "createGame",
        args: [amountWei, modeEnum, userCommit],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // ✅ Decode GameCreated from GAME contract logs (NOT the vault)
      let gameId: Hex | null = null;
      let randAnchor: Hex | null = null;

      for (const log of receipt.logs) {
        if ((log.address ?? "").toLowerCase() !== gameAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: LILYPAD_LEAP_GAME_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "GameCreated") {
            gameId = (decoded.args as any).gameId as Hex;
            randAnchor = (decoded.args as any).randAnchor as Hex;
            break;
          }
        } catch {}
      }

      if (!gameId || !isHex(gameId) || gameId.length !== 66) {
        throw new Error("GameCreated event not found in receipt. (Make sure you're using the GAME address + ABI.)");
      }

      setActiveGameId(gameId);
      setActiveRandAnchor(randAnchor);

      // ✅ store secret locally so /verify can find it on same device
      setStoredSecret(effectiveChainId, gameAddress as Hex, gameId, userSecret);

      // ✅ Build shareable verification bundle for cross-device
      setVerifyBundle(
        buildVerifyBundle({
          chainId: effectiveChainId,
          vault: vaultAddress as Hex,
          game: gameAddress as Hex,
          gameId,
          userSecret,
          createTxHash: hash as Hex,
          cashoutHop: 1,
        })
      );

      setHasStarted(true);
      setOutcome("idle");
      setOutcomeText("Game started on-chain. Hop in the UI, then Cash Out to settle.");

      playSound("start");

      try {
        await refetchBalance();
      } catch {}

      setTxStatus("On-chain game started.");
      window.setTimeout(() => setTxStatus(""), 1400);
      window.setTimeout(() => scrollToBoard(), 140);
      setStartPending(false);
    } catch (e: any) {
      setTxStatus("");
      setTxError(e?.shortMessage || e?.message || "createGame failed");
      setStartPending(false);
    }
  }

  function hopOnce() {
    if (!canHop) return;

    playSound("hop");

    let rollPct: number;
    let passed: boolean;
    let requiredPct: number;

    if (playMode === "token") {
      // ✅ EXACT match with Solidity
      if (!tokenSeed) {
        setTxError("Missing token seed. Please START again.");
        return;
      }
      if (!tokenChainOk) {
        setTxError("Wrong network. Switch back to Linea/Base.");
        return;
      }

      const hopNo = nextHopNo; // 1..10
      const h = keccak256(encodePacked(["bytes32", "uint8"], [tokenSeed, hopNo])) as Hex;
      const rBps = Number(BigInt(h) % 10000n); // 0..9999
      rollPct = rBps / 100;

      const pBps = modeKey === "safe" ? 9000 : modeKey === "wild" ? 8200 : 6900;
      requiredPct = pBps / 100;

      // ✅ IMPORTANT: contract uses lose if r >= p, win if r < p
      passed = rBps < pBps;
    } else {
      const u = xorshift32(rngState);
      rollPct = uint32ToRoll(u);

      requiredPct = stepSuccessPctExact;
      // demo uses <= (UI-only), but token mode is exact contract math
      passed = rollPct <= requiredPct;

      setRngState(u);
    }

    setLastRoll(rollPct);
    setLastAttemptHop(nextHopNo);
    setLastRequiredPct(requiredPct);

    setHopPulse(true);
    window.setTimeout(() => setHopPulse(false), 160);

    if (!passed) {
      setIsFailed(true);
      setOutcome("bust");
      setOutcomeText(`Failed on hop ${nextHopNo}. Roll ${rollPct.toFixed(3)} > ${requiredPct.toFixed(6)}%.`);

      setFailFlash(true);
      window.setTimeout(() => setFailFlash(false), 380);

      playSound("busted");
      triggerAnim("hop_fail");

      window.setTimeout(() => scrollToBoard(), 140);
      return;
    }

    // Passed
    const completedHop = nextHopNo;
    setHops(completedHop);

    const newMult = multTable[nextHopIndex];
    setCurrentMult(newMult);

    setOutcome("success");
    setOutcomeText(
      `Hop ${completedHop} cleared. Roll ${rollPct.toFixed(3)} ≤ ${requiredPct.toFixed(6)}%. Cash Out now: ${fmtX(
        newMult
      )}.`
    );

    setPoppedHop(completedHop);
    window.setTimeout(() => setPoppedHop(null), 420);

    triggerAnim("hop_ok");

    // MAX HIT reached
    if (completedHop >= MAX_HOPS) {
      setOutcome("maxhit");
      setOutcomeText(`MAX HIT achieved: ${MAX_HOPS}/${MAX_HOPS}. Cash Out available at ${fmtX(newMult)}.`);

      playSound("maxhit");
      if (winTimerRef.current) window.clearTimeout(winTimerRef.current);
      winTimerRef.current = window.setTimeout(() => {
        playSound("win");
        winTimerRef.current = null;
      }, 450);

      triggerAnim("max_hit");
    }

    window.setTimeout(() => scrollToBoard(), 160);
  }

  async function settleOnChain(cashoutHop: number) {
    try {
      if (!publicClient) throw new Error("No public client");
      if (playMode !== "token") return;
      if (!mounted || !safeIsConnected || !safeAddress) return;

      if (!tokenChainOk) {
        setTxError("Wrong network. Switch to Linea or Base.");
        return;
      }
      if (!activeGameId || !activeUserSecret) {
        setTxError("Missing on-chain game state. Please start again.");
        return;
      }
      if (gameAddress === zeroAddress) {
        setTxError("Missing game address.");
        return;
      }

      setTxError("");
      setTxStatus("Settling on-chain…");

      const hash = await writeContractAsync({
        chainId: safeChainId as number,
        abi: LILYPAD_LEAP_GAME_ABI,
        address: gameAddress,
        functionName: "cashOut",
        args: [activeGameId, activeUserSecret, cashoutHop],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      let payout: bigint | null = null;
      let won: boolean | null = null;

      // ✅ Decode GameSettled from GAME logs
      for (const log of receipt.logs) {
        if ((log.address ?? "").toLowerCase() !== gameAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: LILYPAD_LEAP_GAME_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "GameSettled") {
            payout = (decoded.args as any).payout as bigint;
            won = (decoded.args as any).won as boolean;
            break;
          }
        } catch {}
      }

      setSettledPayoutWei(payout);
      setSettledWon(won);

      const payoutDtc = payout !== null ? Number(formatUnits(payout, 18)) : null;

      // Mark as ended only after settle succeeds
      setIsCashedOut(true);

      // ✅ Update bundle with cashout hop + settle tx hash
      if (verifyBundle) {
        try {
          const b = JSON.parse(verifyBundle);
          b.cashoutHop = cashoutHop;
          b.txHash = hash;
          setVerifyBundle(JSON.stringify(b, null, 2));
        } catch {}
      }

      if (payout && payout > 0n) {
        setOutcome("cashout");
        setOutcomeText(
          `Settled on-chain at hop ${cashoutHop}. Payout: ${payoutDtc?.toLocaleString("en-US", {
            maximumFractionDigits: 4,
          })} DTC.`
        );
        playSound("cashout");
        triggerAnim("cash_out");
      } else {
        setOutcome("bust");
        setOutcomeText(
          `Settled on-chain at hop ${cashoutHop}. Payout: 0 DTC. (won=${String(won)})`
        );
        playSound("busted");
        triggerAnim("hop_fail");
      }

      try {
        await refetchBalance();
      } catch {}

      setTxStatus("Settled.");
      window.setTimeout(() => setTxStatus(""), 1400);
      window.setTimeout(() => scrollToBoard(), 160);
    } catch (e: any) {
      setTxStatus("");
      setTxError(e?.shortMessage || e?.message || "cashOut failed");
      // IMPORTANT: don’t end run on failure; just unlock the UI
    } finally {
      setCashOutPending(false);
      lockActions(0);
    }
  }

  function cashOut() {
    if (cashOutPending) return;

    if (playMode === "demo") {
      if (!canCashOut) return;
      setIsCashedOut(true);
      setOutcome("cashout");
      setOutcomeText(`Cash Out at ${fmtX(currentMult)}. Estimated return: ${fmtInt(currentReturn)} DTC (demo).`);
      playSound("cashout");
      triggerAnim("cash_out");
      window.setTimeout(() => scrollToBoard(), 160);
      return;
    }

    // TOKEN MODE
    if (!hasStarted || isFailed || isCashedOut || hops <= 0) return;

    if (!tokenChainOk) {
      setTxError("Wrong network. Switch back to Linea/Base to Cash Out.");
      return;
    }

    setCashOutPending(true);
    setTxStatus("Confirm Cash Out in wallet…");
    setActionLocked(true);

    void settleOnChain(hops);
  }

  // Auto-scroll to relevant row on mobile (table)
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    if (!isMobileNow()) return;

    const targetId = isFailed
      ? `hop-row-${lastAttemptHop ?? 1}`
      : isCashedOut
      ? `hop-row-${hops}`
      : `hop-row-${Math.min(hops + 1, MAX_HOPS)}`;

    const el = document.getElementById(targetId);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [hops, isFailed, isCashedOut, lastAttemptHop]);

  // Ensure mobile scroll prefers the OUTCOME BOARD on key state changes
  useEffect(() => {
    if (!mounted) return;
    if (!isMobileNow()) return;
    window.setTimeout(() => scrollToBoard(), 180);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted, hops, isFailed, isCashedOut, actionLocked, animEvent, animNonce, cashOutPending, mounted]);

  // Visible hop rows (mobile-friendly collapse)
  const visibleHopSet = useMemo(() => {
    if (showAllSteps) return new Set<number>(Array.from({ length: MAX_HOPS }, (_, i) => i + 1));

    const s = new Set<number>();

    if (!hasStarted) {
      s.add(1);
      s.add(2);
      return s;
    }

    if (isFailed) {
      const h = lastAttemptHop ?? 1;
      s.add(Math.max(1, h - 1));
      s.add(h);
      s.add(Math.min(MAX_HOPS, h + 1));
      return s;
    }

    if (hops <= 0) {
      s.add(1);
      s.add(2);
      return s;
    }

    if (hops >= MAX_HOPS) {
      s.add(MAX_HOPS - 1);
      s.add(MAX_HOPS);
      return s;
    }

    s.add(Math.max(1, hops - 1));
    s.add(hops);
    s.add(hops + 1);
    return s;
  }, [showAllSteps, hasStarted, isFailed, lastAttemptHop, hops]);

  const padFxClass =
    animEvent === "hop_ok"
      ? "padFxOk"
      : animEvent === "hop_fail"
      ? "padFxFail"
      : animEvent === "cash_out"
      ? "padFxCash"
      : animEvent === "max_hit"
      ? "padFxMax"
      : "";

  const modeToneClass = modeKey === "safe" ? "toneSafe" : modeKey === "wild" ? "toneWild" : "toneInsane";

  const showPostOutcomeButtons = ended;

  const bottomPrimaryLabel = useMemo(() => {
    if (cashOutPending) return "SETTLING…";
    if (!hasStarted) return "START";
    if (hops >= MAX_HOPS) return "CASH OUT";
    return "HOP";
  }, [cashOutPending, hasStarted, hops]);

  const bottomPrimaryDisabled = useMemo(() => {
    if (cashOutPending) return true;
    if (!hasStarted) return !canStart;
    if (hops >= MAX_HOPS) return !canCashOut;
    return !canHop;
  }, [cashOutPending, hasStarted, canStart, hops, canCashOut, canHop]);

  function onBottomPrimary() {
    if (cashOutPending) return;
    if (!hasStarted) {
      void startRun();
      return;
    }
    if (hops >= MAX_HOPS) {
      cashOut();
      return;
    }
    hopOnce();
  }

  const bottomHint = useMemo(() => {
    if (cashOutPending) return "Cash Out pending — confirm in wallet / waiting for tx…";
    if (showPostOutcomeButtons) return "Busted or cashed out — choose your next move.";
    if (!hasStarted) return "Start a run.";
    if (hops >= MAX_HOPS) return "MAX HIT — cash out to lock it in.";
    return actionLocked ? "…" : "Take the Leap!";
  }, [cashOutPending, showPostOutcomeButtons, hasStarted, hops, actionLocked]);

  const soundEmoji = soundOn ? "📢" : "🔇";

  const headerNetworkName =
    mounted && playMode === "token" && safeIsConnected && tokenChainOk
      ? CHAIN_LIST.find((c) => c.chainId === safeChainId)?.name ?? "—"
      : selectedChain.name;

  const balanceNetworkName = useMemo(() => {
    if (!mounted) return "—";
    if (!safeIsConnected || !safeAddress) return "—";
    if (playMode === "token") {
      if (!tokenChainOk) return "Wrong Network";
      return CHAIN_LIST.find((c) => c.chainId === safeChainId)?.name ?? "—";
    }
    return selectedChain.name;
  }, [mounted, safeIsConnected, safeAddress, playMode, tokenChainOk, safeChainId, selectedChain.name]);

  // ✅ TOKEN mode chooser (hard-gated; auto-switch if possible)
  async function enterTokenMode() {
    if ((hasStarted && !ended) || startPending || cashOutPending) return;

    if (!mounted || !safeIsConnected || !safeAddress) {
      setTxError("Connect your wallet to use TOKEN mode.");
      setPlayMode("demo");
      return;
    }

    if (!isTokenChain(safeChainId)) {
      const target =
        selectedChain.chainId === 59144 || selectedChain.chainId === 8453 ? selectedChain.chainId : 59144;

      try {
        setTxError("");
        setTxStatus("Switch network to use TOKEN mode…");
        await switchChain?.({ chainId: target });
        window.setTimeout(() => setTxStatus(""), 900);
      } catch {
        setTxStatus("");
        setTxError("Wrong network. Switch to Linea or Base to use TOKEN mode.");
        setPlayMode("demo");
        return;
      }
    }

    setTxError("");

    // Hard guard: addresses must exist
const cid = safeChainId as number;

if (!GAME_BY_CHAIN[cid] || GAME_BY_CHAIN[cid] === zeroAddress) {
  setTxError("TOKEN mode is not configured for this chain (missing GAME address).");
  setPlayMode("demo");
  return;
}
if (!VAULT_BY_CHAIN[cid] || VAULT_BY_CHAIN[cid] === zeroAddress) {
  setTxError("TOKEN mode is not configured for this chain (missing VAULT address).");
  setPlayMode("demo");
  return;
}
if (!DTC_BY_CHAIN[cid] || DTC_BY_CHAIN[cid] === zeroAddress) {
  setTxError("TOKEN mode is not configured for this chain (missing TOKEN address).");
  setPlayMode("demo");
  return;
}


    setPlayMode("token");
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <style jsx global>{`
        /* Hide scrollbars but keep scrolling */
        .noScrollbars {
          scrollbar-width: none; /* Firefox */
          -ms-overflow-style: none; /* IE/Edge legacy */
        }
        .noScrollbars::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none; /* Chrome/Safari */
        }

        @keyframes rowPop {
          0% {
            transform: scale(1);
            box-shadow: none;
          }
          45% {
            transform: scale(1.02);
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.35), 0 0 24px rgba(16, 185, 129, 0.2);
          }
          100% {
            transform: scale(1);
            box-shadow: none;
          }
        }
        @keyframes failShake {
          0% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-6px);
          }
          40% {
            transform: translateX(6px);
          }
          60% {
            transform: translateX(-5px);
          }
          80% {
            transform: translateX(5px);
          }
          100% {
            transform: translateX(0);
          }
        }
        @keyframes failFlash {
          0% {
            opacity: 0;
          }
          25% {
            opacity: 0.55;
          }
          100% {
            opacity: 0;
          }
        }
        @keyframes hopPulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.03);
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes activeGlow {
          0%,
          100% {
            box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.12);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.18), 0 0 18px rgba(148, 163, 184, 0.1);
          }
        }
        @keyframes soundPulseGlow {
          0%,
          100% {
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.18), 0 0 0 rgba(16, 185, 129, 0);
            transform: translateZ(0);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.28), 0 0 18px rgba(16, 185, 129, 0.12);
          }
        }
        .soundPulse {
          animation: soundPulseGlow 1.35s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .soundPulse {
            animation: none !important;
          }
        }

        @keyframes selectedGlowPulse {
          0%,
          100% {
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.25), 0 0 18px rgba(16, 185, 129, 0.1);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.35), 0 0 28px rgba(16, 185, 129, 0.16);
          }
        }
        .selectedGlow {
          animation: selectedGlowPulse 1.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .selectedGlow {
            animation: none !important;
          }
        }

        @keyframes padBob {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-2px);
          }
        }
        @keyframes padRipple {
          0% {
            transform: translate(-50%, -50%) scale(0.7);
            opacity: 0;
          }
          15% {
            opacity: 0.28;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.55);
            opacity: 0;
          }
        }
        @keyframes padOk {
          0% {
            transform: translateY(0) scale(1);
          }
          55% {
            transform: translateY(-2px) scale(1.01);
          }
          100% {
            transform: translateY(0) scale(1);
          }
        }
        @keyframes padFail {
          0% {
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
          60% {
            transform: translateY(2px) scale(0.995);
            filter: saturate(0.8);
          }
          100% {
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
        }
        @keyframes padCash {
          0% {
            box-shadow: 0 0 0 rgba(16, 185, 129, 0);
          }
          50% {
            box-shadow: 0 0 32px rgba(16, 185, 129, 0.18);
          }
          100% {
            box-shadow: 0 0 0 rgba(16, 185, 129, 0);
          }
        }
        @keyframes padMax {
          0% {
            box-shadow: 0 0 0 rgba(250, 204, 21, 0);
          }
          45% {
            box-shadow: 0 0 48px rgba(250, 204, 21, 0.22);
          }
          100% {
            box-shadow: 0 0 0 rgba(250, 204, 21, 0);
          }
        }

        .toneSafe {
          background: radial-gradient(circle at 50% 15%, rgba(56, 189, 248, 0.14), transparent 55%),
            radial-gradient(circle at 25% 85%, rgba(34, 197, 94, 0.12), transparent 55%),
            linear-gradient(180deg, rgba(2, 6, 23, 0.55), rgba(2, 6, 23, 0.25));
        }
        .toneWild {
          background: radial-gradient(circle at 50% 15%, rgba(168, 85, 247, 0.16), transparent 55%),
            radial-gradient(circle at 25% 85%, rgba(34, 197, 94, 0.1), transparent 55%),
            linear-gradient(180deg, rgba(2, 6, 23, 0.55), rgba(2, 6, 23, 0.25));
        }
        .toneInsane {
          background: radial-gradient(circle at 50% 15%, rgba(244, 63, 94, 0.16), transparent 55%),
            radial-gradient(circle at 25% 85%, rgba(250, 204, 21, 0.12), transparent 55%),
            linear-gradient(180deg, rgba(2, 6, 23, 0.55), rgba(2, 6, 23, 0.25));
        }
        .padFxOk {
          animation: padOk 260ms ease-out;
        }
        .padFxFail {
          animation: padFail 520ms ease-out;
        }
        .padFxCash {
          animation: padCash 520ms ease-out;
        }
        .padFxMax {
          animation: padMax 680ms ease-out;
        }
      `}</style>

      {failFlash ? (
        <div
          className="pointer-events-none fixed inset-0 z-50"
          style={{
            background: "rgba(239,68,68,0.35)",
            animation: "failFlash 380ms ease-out forwards",
          }}
        />
      ) : null}

      <TopNav
        playMode={playMode}
        setPlayMode={setPlayMode}
        soundOn={soundOn}
        setSoundOn={setSoundOn}
        controlsLocked={(hasStarted && !ended) || startPending || cashOutPending}
      />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Play</h1>
              <p className="mt-2 text-neutral-300">
                Choose a route, set an amount, then decide: <b>HOP</b> or <b>CASH OUT</b> — up to <b>10 hops</b>.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-200 ring-1 ring-emerald-500/20">
                  DEMO: Local simulation
                </span>
                <span className="rounded-full bg-neutral-50/10 px-2 py-0.5 font-semibold text-neutral-100 ring-1 ring-neutral-200/20">
                  TOKEN: On-chain settle at Cash Out
                </span>
              </div>
            </div>

            <div className="text-sm text-neutral-400">
              Network:{" "}
              <span suppressHydrationWarning className="text-neutral-100">
                {headerNetworkName}
              </span>
            </div>
          </div>

          {/* Chain selection (compact switch) */}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-semibold text-neutral-100">Network</div>

              <div className="flex w-full max-w-xl items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900/40 p-1">
                {CHAIN_LIST.map((c) => {
                  const isSelected = c.key === selectedChainKey;
                  const isDisabled = c.enabled === false || (hasStarted && !ended) || startPending || cashOutPending;

                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => {
                        if (isDisabled) return;
                        setSelectedChainKey(c.key);

                        // Optional wallet switch, but DON'T force-switch in TOKEN mode to unsupported chains.
                        if (mounted && safeIsConnected && switchChain) {
                          if (playMode === "token" && !isTokenChain(c.chainId)) return;
                          try {
                            switchChain({ chainId: c.chainId });
                          } catch {}
                        }
                      }}
                      disabled={isDisabled}
                      className={[
                        "flex flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition",
                        isDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-neutral-800/40",
                        isSelected
                          ? "bg-neutral-950 border border-emerald-500/25 selectedGlow"
                          : "border border-transparent opacity-70 hover:opacity-100",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <ChainIcon chainKey={c.key} alt={`${c.name} icon`} />
                        <div className="leading-tight">
                          <div className="text-sm font-semibold text-neutral-100">{c.name}</div>
                          <div className="text-[11px] text-neutral-500">Chain ID: {c.chainId}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isSelected ? (
                          <span
                            className={
                              c.statusTag === "LIVE"
                                ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/25"
                                : "rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/25"
                            }
                          >
                            {c.statusTag}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 text-xs text-neutral-500">{selectedChain.note}</div>
          </div>

          {/* Main play UI */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
            {/* Controls */}
            <div
              className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5"
              style={isFailed ? { animation: "failShake 420ms ease-out" } : undefined}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-neutral-100">Controls</div>
                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-xs font-semibold ring-1",
                    playMode === "token"
                      ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/20"
                      : "bg-neutral-800/50 text-neutral-200 ring-neutral-700",
                  ].join(" ")}
                >
                  {playMode === "token" ? "TOKEN" : "DEMO"}
                </span>
              </div>

              {/* Wallet / Play mode */}
              <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-neutral-200">Wallet</div>
                    <div suppressHydrationWarning className="mt-0.5 text-[11px] text-neutral-500">
                      {mounted && safeIsConnected && safeAddress
                        ? `Connected: ${safeAddress.slice(0, 6)}…${safeAddress.slice(-4)}`
                        : "Not connected"}
                    </div>

                    {mounted && safeIsConnected ? (
                      <div suppressHydrationWarning className="mt-0.5 text-[11px] text-neutral-500">
                        Network: {CHAIN_LIST.find((c) => c.chainId === safeChainId)?.name ?? "—"}
                        {!tokenChainOk ? " (unsupported for TOKEN)" : ""}
                      </div>
                    ) : null}
                  </div>

                  {safeIsConnected ? (
                    <button
                      type="button"
                      onClick={() => disconnect()}
                      className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-200 hover:bg-neutral-800/60"
                    >
                      DISCONNECT
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const c0 = safeConnectors?.[0];
                        if (!mounted || !c0) return;
                        connect({ connector: c0 });
                      }}
                      disabled={!mounted || safeConnectPending || safeConnectors.length === 0}
                      className={[
                        "rounded-xl border px-3 py-2 text-xs font-extrabold tracking-wide transition",
                        !mounted || safeConnectPending || safeConnectors.length === 0
                          ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
                      ].join(" ")}
                    >
                      {!mounted ? "LOADING…" : safeConnectPending ? "CONNECTING…" : "CONNECT"}
                    </button>
                  )}
                </div>

                {safeIsConnected ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if ((hasStarted && !ended) || startPending || cashOutPending) return;
                        setTxError("");
                        setPlayMode("demo");
                      }}
                      disabled={(hasStarted && !ended) || startPending || cashOutPending}
                      className={[
                        "flex-1 rounded-xl border px-3 py-2 text-xs font-extrabold tracking-wide transition",
                        playMode === "demo"
                          ? "border-neutral-700 bg-neutral-800 text-neutral-50"
                          : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                      ].join(" ")}
                    >
                      DEMO
                    </button>
                    <button
                      type="button"
                      onClick={() => void enterTokenMode()}
                      disabled={(hasStarted && !ended) || startPending || cashOutPending}
                      className={[
                        "flex-1 rounded-xl border px-3 py-2 text-xs font-extrabold tracking-wide transition",
                        playMode === "token"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                      ].join(" ")}
                    >
                      TOKEN
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 text-[11px] text-neutral-500">
                    Demo is always available. Connect to play with real transfers.
                  </div>
                )}

                {mounted && safeIsConnected && playMode === "token" && !tokenChainOk ? (
                  <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-200">
                    <b>Wrong network.</b> TOKEN mode works only on <b>Linea</b> or <b>Base</b>.
                  </div>
                ) : null}
              </div>

              {txStatus ? (
                <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[11px] text-neutral-200">
                  {txStatus}
                </div>
              ) : null}

              {txError ? (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-200">
                  {txError}
                </div>
              ) : null}

              {/* ✅ Verify bundle UI (only appears after TOKEN start) */}
              {playMode === "token" && verifyBundle ? (
                <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-neutral-200">Verify bundle</div>
                      <div className="mt-0.5 text-[11px] text-neutral-500">
                        Save this. Paste into /verify on any device.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await copyText(verifyBundle);
                        if (ok) {
                          setVerifyBundleCopied(true);
                          window.setTimeout(() => setVerifyBundleCopied(false), 900);
                        }
                      }}
                      className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                    >
                      {verifyBundleCopied ? "COPIED" : "COPY JSON"}
                    </button>
                  </div>

                  <pre className="noScrollbars mt-3 max-h-40 overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-[11px] text-neutral-200 whitespace-pre-wrap break-words">
                    {verifyBundle}
                  </pre>
                </div>
              ) : null}

              {/* Sound toggle */}
              <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
                      <span
                        aria-hidden="true"
                        className={[
                          "inline-flex h-6 w-6 items-center justify-center rounded-lg border text-sm",
                          soundOn
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                            : "border-neutral-800 bg-neutral-900 text-neutral-300",
                        ].join(" ")}
                        title={soundOn ? "Sound ON" : "Sound OFF"}
                      >
                        {soundEmoji}
                      </span>
                      Sound
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-500">
                      {soundOn ? "ON (default)" : "OFF (muted)"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSoundOn((v) => !v)}
                    className={[
                      "rounded-xl border px-3 py-2 text-xs font-extrabold tracking-wide transition",
                      soundOn
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                        : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                      soundOn ? "soundPulse" : "",
                    ].join(" ")}
                    aria-pressed={soundOn}
                    aria-label={soundOn ? "Mute sound" : "Enable sound"}
                  >
                    {soundOn ? "📢 SOUND: ON" : "🔇 SOUND: OFF"}
                  </button>
                </div>
              </div>

              {/* Mode */}
              <div ref={modeScrollRef} className="mt-4 scroll-mt-24">
                <div className="text-xs text-neutral-400">Route</div>
                <div className="mt-2 flex gap-2">
                  {(Object.keys(MODE) as ModeKey[]).map((k) => {
                    const r = MODE[k];
                    const active = r.key === modeKey;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => {
                          if (hasStarted || startPending || cashOutPending) return;
                          setModeKey(r.key);
                        }}
                        className={[
                          "rounded-xl border px-4 py-2 text-sm font-semibold transition",
                          hasStarted || startPending || cashOutPending ? "opacity-60 cursor-not-allowed" : "",
                          active
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800/60",
                        ].join(" ")}
                        disabled={hasStarted || startPending || cashOutPending}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-neutral-500">{mode.subtitle}</div>
              </div>

              {/* Amount */}
              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-neutral-400">Amount (DTC)</div>

                  <div className="text-[11px] text-neutral-500">
                    <span className="mr-2 text-neutral-600">{balanceNetworkName}</span>
                    {isWrongNetwork ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-200">
                        ⚠️ Wrong network
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900/60 px-2 py-0.5 font-semibold text-neutral-200">
                        Balance: <span className="text-neutral-50">{balanceLabel}</span> <DtcIcon size={12} />
                      </span>
                    )}
                  </div>
                </div>

                <input
                  value={amountRaw}
                  onChange={(e) => sanitizeAndSetAmount(e.target.value)}
                  inputMode="numeric"
                  placeholder={`${MIN_AMOUNT}`}
                  disabled={hasStarted || startPending || cashOutPending}
                  className={[
                    "mt-2 w-full rounded-xl border bg-neutral-900 px-4 py-3 text-sm text-neutral-50 outline-none ring-0 placeholder:text-neutral-600",
                    hasStarted || startPending || cashOutPending
                      ? "cursor-not-allowed border-neutral-900 opacity-60"
                      : "border-neutral-800 focus:border-neutral-700",
                  ].join(" ")}
                />

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAmountPreset(1_000)}
                    disabled={hasStarted || startPending || cashOutPending}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100",
                      hasStarted || startPending || cashOutPending
                        ? "cursor-not-allowed border-neutral-900 opacity-60"
                        : "border-neutral-800 hover:bg-neutral-800/60",
                    ].join(" ")}
                  >
                    1,000 <DtcIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmountPreset(5_000)}
                    disabled={hasStarted || startPending || cashOutPending}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100",
                      hasStarted || startPending || cashOutPending
                        ? "cursor-not-allowed border-neutral-900 opacity-60"
                        : "border-neutral-800 hover:bg-neutral-800/60",
                    ].join(" ")}
                  >
                    5,000 <DtcIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmountPreset(12_000)}
                    disabled={hasStarted || startPending || cashOutPending}
                    className={[
                      "rounded-xl border bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100",
                      hasStarted || startPending || cashOutPending
                        ? "cursor-not-allowed border-neutral-900 opacity-60"
                        : "border-neutral-800 hover:bg-neutral-800/60",
                    ].join(" ")}
                  >
                    12,000 <DtcIcon />
                  </button>
                </div>

                <div className="mt-2 text-xs text-neutral-500">
                  Max game = {fmtInt(MAX_AMOUNT)} <DtcIcon size={12} />
                </div>

                {playMode === "token" ? (
                  <>
                    <ApprovalToggle
                      chainId={effectiveChainId}
                      wallet={(safeAddress ?? null) as any}
                      amountDtc={amount}
                      maxAmountDtc={MAX_AMOUNT}
                      onPolicyChange={(p) => setApprovalPolicy(p)}
                    />

                    <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-neutral-200">Allowance</div>
                          <div className="mt-0.5 text-[11px] text-neutral-500">
                            {tokenAddress === zeroAddress
                              ? "Token address not set in this file (allowance display disabled)."
                              : hasEnoughAllowance
                              ? "✅ Sufficient"
                              : "⚠️ Needs approval"}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={approveNow}
                          disabled={
                            !mounted ||
                            !safeIsConnected ||
                            !safeAddress ||
                            !tokenChainOk ||
                            tokenAddress === zeroAddress ||
                            hasEnoughAllowance ||
                            cashOutPending
                          }
                          className={[
                            "rounded-xl border px-3 py-2 text-xs font-extrabold tracking-wide transition",
                            !mounted ||
                            !safeIsConnected ||
                            !safeAddress ||
                            !tokenChainOk ||
                            tokenAddress === zeroAddress ||
                            hasEnoughAllowance ||
                            cashOutPending
                              ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15",
                          ].join(" ")}
                        >
                          APPROVE
                        </button>
                      </div>

                      <div className="mt-2 text-[11px] text-neutral-500">
                        Token Mode settles on-chain at Cash Out. The hop animation is UX-only, but the pass/fail math is now EXACT.
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="mt-1 text-xs text-neutral-600">{hasStarted ? "Locked after START." : "Set before START."}</div>

                {maxClampNotice ? (
                  <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    Max game = {fmtInt(MAX_AMOUNT)} <DtcIcon size={12} />
                  </div>
                ) : null}
              </div>

              {/* Run status */}
              <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Run status</div>
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                      playMode === "token"
                        ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20"
                        : "bg-neutral-800/50 text-neutral-200 ring-neutral-700",
                    ].join(" ")}
                  >
                    {playMode === "token" ? "TOKEN" : "DEMO"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">State</span>
                    <span className="font-semibold">
                      {!hasStarted
                        ? "Not started"
                        : cashOutPending
                        ? "CASH OUT PENDING…"
                        : isFailed
                        ? "FAILED"
                        : isCashedOut
                        ? "CASHED OUT"
                        : maxHit
                        ? "MAX HIT"
                        : actionLocked
                        ? "Animating…"
                        : "In run"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Hops</span>
                    <span className="font-semibold">
                      {hops}/{MAX_HOPS}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Next hop success</span>
                    <span className="font-semibold">
                      {nextHopSuccessExact === null
                        ? "—"
                        : `${ceilPercent(nextHopSuccessExact)} (exact ${nextHopSuccessExact.toFixed(6)}%)`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Amount</span>
                    <span className="font-semibold">
                      {fmtInt(amount)}{" "}
                      <span className="ml-1">
                        <DtcIcon size={12} />
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Cash Out now</span>
                    <span className="font-semibold">{hops === 0 ? "—" : fmtX(currentMult)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-300">Estimated return</span>
                    <span className="font-semibold">{hops === 0 ? "—" : `${fmtInt(currentReturn)} DTC`}</span>
                  </div>

                  {playMode === "token" && isCashedOut ? (
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-300">On-chain result</span>
                      <span className="font-semibold">
                        {settledPayoutWei === null ? "—" : `${Number(formatUnits(settledPayoutWei, 18)).toLocaleString("en-US", { maximumFractionDigits: 6 })} DTC`}
                        {settledWon !== null ? ` (won=${String(settledWon)})` : ""}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
                  <button
                    type="button"
                    onClick={async () => {
                      setCommitExpanded((v) => !v);
                      const ok = await copyText(commitHash);
                      if (ok) {
                        setCommitCopied(true);
                        window.setTimeout(() => setCommitCopied(false), 900);
                      }
                    }}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-neutral-500">Commit hash</span>
                      <span className="text-neutral-600">{commitCopied ? "copied" : commitExpanded ? "▴" : "▾"}</span>
                    </div>

                    <div className="mt-1 break-all font-mono text-neutral-200">
                      {commitExpanded ? commitHash : truncateHashFirstLast(commitHash)}
                    </div>

                    <div className="mt-1 text-[11px] text-neutral-600">
                      Demo placeholder. Token-mode fairness uses on-chain commit-reveal.
                    </div>
                  </button>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-neutral-500">Last roll</span>
                    <span className="font-mono text-neutral-200">{formatRoll(lastRoll)}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-5 grid gap-2">
                {!hasStarted ? (
                  <button
                    type="button"
                    onClick={startRun}
                    disabled={!canStart}
                    className={[
                      "rounded-xl px-4 py-3 text-sm font-extrabold tracking-wide transition",
                      canStart
                        ? "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                        : "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500",
                    ].join(" ")}
                  >
                    START
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (cashOutPending) return;
                        hopOnce();
                      }}
                      disabled={!canHop || cashOutPending}
                      className={[
                        "rounded-xl px-4 py-3 text-sm font-extrabold tracking-wide transition",
                        cashOutPending
                          ? "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500"
                          : canHop
                          ? "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                          : "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500",
                      ].join(" ")}
                      style={hopPulse ? { animation: "hopPulse 160ms ease-out" } : undefined}
                    >
                      {cashOutPending ? "SETTLING…" : "HOP"}
                    </button>

                    <button
                      type="button"
                      onClick={cashOut}
                      disabled={!canCashOut || cashOutPending}
                      className={[
                        "rounded-xl px-4 py-3 text-sm font-extrabold tracking-wide transition",
                        canCashOut && !cashOutPending
                          ? "bg-neutral-50 text-neutral-950 hover:bg-white"
                          : "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500",
                      ].join(" ")}
                    >
                      {cashOutPending ? "SETTLING…" : "CASH OUT"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right side: Board + Table */}
            <div className="grid gap-6" ref={tableWrapRef}>
              {/* Board */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-sm font-semibold text-neutral-100">Make Your Bags Great Again 🐸💰</div>
                    <div className="mt-1 text-xs text-neutral-500">Donald Toad Coin • community-driven</div>
                  </div>
                  <div className="text-xs text-neutral-400">
                    Chain: <span className="text-neutral-200">{selectedChain.name}</span> (UI)
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30">
                  <div
                    ref={boardScrollRef}
                    className={`relative w-full ${modeToneClass}`}
                    style={{ paddingTop: "64%", minHeight: 420 }}
                  >
                    <div className="absolute inset-0">
                      <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/20 via-neutral-950/10 to-neutral-950/30" />
                      <div
                        className="absolute inset-0 opacity-[0.06]"
                        style={{
                          backgroundImage:
                            "radial-gradient(circle at 20% 20%, #fff 0 1px, transparent 2px), radial-gradient(circle at 80% 30%, #fff 0 1px, transparent 2px), radial-gradient(circle at 40% 75%, #fff 0 1px, transparent 2px)",
                          backgroundSize: "220px 220px",
                        }}
                      />

                      {/* Pad A (current) */}
                      <div className={`absolute left-[14%] bottom-[14%] h-[32%] w-[44%] ${padFxClass}`}>
                        <div
                          className="absolute inset-0 rounded-[999px] border border-emerald-300/10"
                          style={{
                            background:
                              "radial-gradient(circle at 35% 35%, rgba(34,197,94,0.22), rgba(34,197,94,0.10) 45%, rgba(16,185,129,0.05) 70%, rgba(0,0,0,0) 100%)",
                            boxShadow: "inset 0 0 0 1px rgba(16,185,129,0.08), 0 10px 30px rgba(0,0,0,0.35)",
                            animation: "padBob 1.8s ease-in-out infinite",
                          }}
                        />
                        <div
                          className="absolute left-1/2 top-1/2 h-[68%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-[999px] border border-neutral-50/10"
                          style={{
                            background:
                              "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 60%, rgba(0,0,0,0) 100%)",
                          }}
                        />
                        <div
                          className="absolute left-1/2 top-1/2 h-[120%] w-[120%] rounded-[999px] border border-neutral-50/10"
                          style={{
                            transform: "translate(-50%, -50%)",
                            animation:
                              animEvent === "hop_ok" || animEvent === "hop_fail" ? "padRipple 520ms ease-out" : "none",
                          }}
                        />
                      </div>

                      {/* Pad B (next) */}
                      <div className={`absolute right-[12%] bottom-[22%] h-[24%] w-[34%] ${padFxClass}`}>
                        <div
                          className="absolute inset-0 rounded-[999px] border border-emerald-300/10"
                          style={{
                            background:
                              "radial-gradient(circle at 40% 40%, rgba(34,197,94,0.18), rgba(34,197,94,0.08) 50%, rgba(16,185,129,0.03) 75%, rgba(0,0,0,0) 100%)",
                            boxShadow: "inset 0 0 0 1px rgba(16,185,129,0.06), 0 8px 24px rgba(0,0,0,0.32)",
                            animation: "padBob 2.1s ease-in-out infinite",
                          }}
                        />
                        {hops >= MAX_HOPS - 1 ? (
                          <div
                            className="absolute inset-0 rounded-[999px]"
                            style={{
                              boxShadow:
                                animEvent === "max_hit" || outcome === "maxhit"
                                  ? "0 0 0 1px rgba(250,204,21,0.25), 0 0 38px rgba(250,204,21,0.18)"
                                  : "0 0 0 1px rgba(250,204,21,0.14)",
                            }}
                          />
                        ) : null}
                      </div>
                    </div>

                    <div key={`${animEvent}-${animNonce}`} className="absolute inset-0 z-10">
                      <OutcomeBoard
                        outcome={outcome}
                        animEvent={animEvent}
                        animNonce={animNonce}
                        hops={hops}
                        maxHops={MAX_HOPS}
                        currentMult={currentMult}
                        currentReturn={currentReturn}
                        modeKey={modeKey}
                        onCashOut={cashOut}
                        cashOutEnabled={canCashOut && !cashOutPending}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* PRIMARY CTA under Canvas */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                {!ended ? (
                  <button
                    type="button"
                    onClick={onBottomPrimary}
                    disabled={bottomPrimaryDisabled}
                    className={[
                      "w-full rounded-2xl px-4 py-4 text-base font-extrabold tracking-wide transition",
                      bottomPrimaryDisabled
                        ? "cursor-not-allowed border border-neutral-800 bg-neutral-900 text-neutral-500"
                        : "bg-emerald-500 text-neutral-950 hover:bg-emerald-400",
                    ].join(" ")}
                    style={hopPulse ? { animation: "hopPulse 160ms ease-out" } : undefined}
                  >
                    {bottomPrimaryLabel}
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={playAgainSameAmount}
                      className="rounded-2xl px-4 py-4 text-base font-extrabold tracking-wide transition bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                    >
                      PLAY AGAIN
                    </button>

                    <button
                      type="button"
                      onClick={changeAmountFlow}
                      className="rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-4 text-base font-extrabold tracking-wide text-neutral-100 hover:bg-neutral-800/60"
                    >
                      CHANGE AMOUNT
                    </button>
                  </div>
                )}

                <div className="mt-2 text-center text-[11px] text-neutral-500">{bottomHint}</div>
              </div>

              {/* Outcome banner */}
              {outcome !== "idle" ? (
                <div
                  className={[
                    "rounded-2xl border p-3 text-sm",
                    outcome === "success"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                      : outcome === "cashout"
                      ? "border-neutral-200/15 bg-neutral-50/10 text-neutral-100"
                      : outcome === "maxhit"
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                      : "border-red-500/20 bg-red-500/10 text-red-100",
                  ].join(" ")}
                >
                  {outcomeText}
                </div>
              ) : null}

              {/* Table */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-sm font-semibold text-neutral-100">
                      Steps, Win probability and Cash Out multiplier
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Token mode is now mathematically exact to the contract.
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAllSteps((v) => !v)}
                      className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100 hover:bg-neutral-800/60"
                    >
                      {showAllSteps ? "Collapse" : "Show all"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800">
                  <div className="grid grid-cols-[90px_1fr_140px] bg-neutral-900/60 px-4 py-3 text-xs font-semibold text-neutral-300">
                    <div>Hop</div>
                    <div className="text-center">Success Probability</div>
                    <div className="text-right">Cash Out</div>
                  </div>

                  <div className="divide-y divide-neutral-800">
                    {Array.from({ length: MAX_HOPS }, (_, idx) => {
                      const hopNo = idx + 1;
                      if (!visibleHopSet.has(hopNo)) return null;

                      const isCompleted = hopNo <= hops && !isFailed;
                      const isActive =
                        hopNo === hops + 1 && !isFailed && !isCashedOut && hasStarted && hops < MAX_HOPS;

                      const rowBase = "grid grid-cols-[90px_1fr_140px] px-4 py-3 text-sm";
                      const rowBg = isCompleted ? "bg-emerald-500/10" : isActive ? "bg-neutral-900/40" : "bg-neutral-950";

                      const popStyle = poppedHop === hopNo ? ({ animation: "rowPop 420ms ease-out" } as const) : undefined;

                      const showRoll = lastAttemptHop === hopNo && lastRoll !== null && lastRequiredPct !== null;

                      const clearedVisible = isCompleted && hops >= 2 && hopNo > Math.max(0, hops - 3);

                      const showFailedChip = isFailed && lastAttemptHop === hopNo;
                      const showCashedChip = isCashedOut && hopNo === hops && hops > 0;
                      const showMaxHitChip = !isFailed && hopNo === MAX_HOPS && hops >= MAX_HOPS;

                      const chip = showFailedChip
                        ? { text: "❌ FAILED", cls: "bg-red-500/10 text-red-200 ring-red-500/20" }
                        : showCashedChip
                        ? { text: "💰 CASHED", cls: "bg-neutral-50/10 text-neutral-100 ring-neutral-200/20" }
                        : showMaxHitChip
                        ? { text: "🏆 MAX HIT", cls: "bg-emerald-500/10 text-emerald-200 ring-emerald-500/20" }
                        : clearedVisible
                        ? { text: "✅ CLEARED", cls: "bg-emerald-500/10 text-emerald-200 ring-emerald-500/20" }
                        : null;

                      return (
                        <div
                          key={hopNo}
                          id={`hop-row-${hopNo}`}
                          className={`${rowBase} ${rowBg}`}
                          style={{
                            ...(popStyle ?? {}),
                            ...(isActive ? ({ animation: "activeGlow 1.1s ease-in-out infinite" } as const) : {}),
                          }}
                        >
                          <div className="font-semibold text-neutral-100">
                            {hopNo}
                            {chip ? (
                              <span
                                className={[
                                  "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
                                  chip.cls,
                                ].join(" ")}
                              >
                                {chip.text}
                              </span>
                            ) : null}
                          </div>

                          <div className="text-center">
                            <span className="font-semibold text-neutral-100">{ceilPercent(stepSuccessPctExact)}</span>

                            {showRoll ? (
                              <span className="ml-2 text-xs text-neutral-400">
                                (roll {formatRoll(lastRoll)} / need &lt; {lastRequiredPct!.toFixed(6)}%)
                              </span>
                            ) : null}
                          </div>

                          <div className="text-right font-semibold text-neutral-100">{fmtX(multTable[idx])}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-300">
                  <b>Important:</b> In TOKEN mode, the contract decides win/loss at settle. This UI now uses the exact same
                  seed formula so “max hit” will match on-chain.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-neutral-600">
            Selected chain: <span className="text-neutral-300">{selectedChain.name}</span> (UI only)
          </div>
        </div>
      </section>
    </main>
  );
}
