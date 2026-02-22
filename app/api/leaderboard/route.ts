import { NextResponse } from "next/server";
import { decodeEventLog, keccak256, toHex, type Abi } from "viem";

export const runtime = "edge";

type Timeframe = "daily" | "weekly" | "monthly" | "all";
type ChainKey = "base" | "linea";

type ApiRow = {
  chains: ChainKey[];
  address: `0x${string}`;
  games: number;
  volumeDtc: number;
  topWinDtc: number;
  profitDtc: number;
  referrals: number;
  claimedDtc: number;
};

type CacheEntry = { exp: number; payload: any };

const DTC_DECIMALS = 18n;

const ETHERSCAN_V2_URL = (process.env.NEXT_PUBLIC_ETHERSCAN_V2_URL || "https://api.etherscan.io/v2/api").trim();
const ETHERSCAN_V2_API_KEY = (process.env.NEXT_PUBLIC_ETHERSCAN_V2_API_KEY || "").trim();

const CHAIN: Record<ChainKey, { chainId: number; game: `0x${string}`; registry: `0x${string}` }> = {
  base: {
    chainId: 8453,
    game: "0x05df07E37B8dF836549B28AA3195FD54D57DD845",
    registry: "0x994a28Bb8d84AacB691bA8773e81dAFC1acEb39B",
  },
  linea: {
    chainId: 59144,
    game: "0x5Eb6920Af0163e749274619E8076666885Bf0B57",
    registry: "0xAbD4c0dF150025a1982FC8236e5880EcC9156BeE",
  },
};

const GAME_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "gameId", type: "bytes32" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: false, internalType: "bool", name: "won", type: "bool" },
      { indexed: false, internalType: "uint8", name: "cashoutHop", type: "uint8" },
      { indexed: false, internalType: "uint256", name: "amountReceived", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "payout", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "houseProfit", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "playerNetWin", type: "uint256" },
      { indexed: false, internalType: "bytes32", name: "userCommitHash", type: "bytes32" },
      { indexed: false, internalType: "bytes32", name: "randAnchor", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "settledAt", type: "uint256" },
    ],
    name: "GameSettled",
    type: "event",
  },
] as const satisfies Abi;

const REG_ABI = [
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
      { indexed: true, internalType: "uint256", name: "epochId", type: "uint256" },
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "Claimed",
    type: "event",
  },
] as const satisfies Abi;

type EsLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  timeStamp: string;
  transactionHash?: string;
  logIndex?: string;
};

function nowMs() {
  return Date.now();
}

function ttlMs(tf: Timeframe) {
  if (tf === "daily") return 60_000;
  if (tf === "weekly") return 120_000;
  if (tf === "monthly") return 180_000;
  return 300_000;
}

function getKey(tf: Timeframe) {
  return `lb:${tf}`;
}

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as any;
  if (!g.__LB_CACHE__) g.__LB_CACHE__ = new Map<string, CacheEntry>();
  return g.__LB_CACHE__;
}

function readCache(key: string) {
  const c = getCache();
  const hit = c.get(key);
  if (!hit) return null;
  if (hit.exp <= nowMs()) {
    c.delete(key);
    return null;
  }
  return hit.payload;
}

function writeCache(key: string, payload: any, ttl: number) {
  getCache().set(key, { exp: nowMs() + ttl, payload });
}

function parseTf(v: string | null): Timeframe {
  if (v === "daily" || v === "weekly" || v === "monthly" || v === "all") return v;
  return "weekly";
}

function toDtc2(n: bigint) {
  const sign = n < 0n ? -1n : 1n;
  const v = n < 0n ? -n : n;
  const base = 10n ** DTC_DECIMALS;
  const whole = v / base;
  const frac = (v % base) / 10n ** (DTC_DECIMALS - 2n);
  const num = Number(whole) + Number(frac) / 100;
  return sign < 0n ? -num : num;
}

function utcRange(tf: Timeframe, now = new Date()) {
  if (tf === "all") return { startSec: 0, endSec: Math.floor(now.getTime() / 1000) + 1 };

  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  if (tf === "daily") {
    const start = Date.UTC(y, m, d, 0, 0, 0) / 1000;
    const end = Date.UTC(y, m, d + 1, 0, 0, 0) / 1000;
    return { startSec: start, endSec: end };
  }

  if (tf === "monthly") {
    const start = Date.UTC(y, m, 1, 0, 0, 0) / 1000;
    const end = Date.UTC(y, m + 1, 1, 0, 0, 0) / 1000;
    return { startSec: start, endSec: end };
  }

  const day = now.getUTCDay();
  const delta = (day + 6) % 7;
  const start = Date.UTC(y, m, d - delta, 0, 0, 0) / 1000;
  const end = Date.UTC(y, m, d - delta + 7, 0, 0, 0) / 1000;
  return { startSec: start, endSec: end };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableText(t: string) {
  const s = t.toLowerCase();
  return s.includes("rate limit") || s.includes("max rate") || s.includes("too many") || s.includes("temporarily") || s.includes("timeout") || s.includes("throttle") || s.includes("busy");
}

async function fetchJsonWithBackoff(url: string, tries = 6) {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
      const txt = await res.text();
      if (!res.ok) {
        if (i < tries - 1 && isRetryableText(txt)) {
          const base = 250 * 2 ** i;
          const jitter = Math.floor(Math.random() * 150);
          await sleep(Math.min(8000, base + jitter));
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      try {
        return JSON.parse(txt);
      } catch {
        throw new Error(`Invalid JSON: ${txt}`);
      }
    } catch (e: any) {
      last = e;
      if (i < tries - 1) {
        const base = 250 * 2 ** i;
        const jitter = Math.floor(Math.random() * 150);
        await sleep(Math.min(8000, base + jitter));
        continue;
      }
      throw last;
    }
  }
  throw last;
}

function qs(params: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.set(k, String(v));
  }
  return u.toString();
}

async function getBlockByTime(chainId: number, timestampSec: number, closest: "before" | "after") {
  const url =
    `${ETHERSCAN_V2_URL}?` +
    qs({
      chainid: chainId,
      module: "block",
      action: "getblocknobytime",
      timestamp: Math.max(0, Math.floor(timestampSec)),
      closest,
      apikey: ETHERSCAN_V2_API_KEY,
    });

  const j = await fetchJsonWithBackoff(url);
  const status = String(j?.status ?? "");
  const msg = String(j?.message ?? "");
  const result = j?.result;

  if (status !== "1") {
    if (msg.toLowerCase().includes("no records")) return null;
    throw new Error(`getblocknobytime failed: ${JSON.stringify(j)}`);
  }

  const bn = Number(result);
  if (!Number.isFinite(bn) || bn < 0) throw new Error(`Invalid block from getblocknobytime: ${JSON.stringify(j)}`);
  return BigInt(bn);
}

async function getLogsByAddressAndTopic0(args: { chainId: number; address: `0x${string}`; fromBlock: bigint; toBlock: bigint; topic0: `0x${string}` }) {
  const out: EsLog[] = [];
  const offset = 1000;
  let page = 1;

  while (true) {
    const url =
      `${ETHERSCAN_V2_URL}?` +
      qs({
        chainid: args.chainId,
        module: "logs",
        action: "getLogs",
        address: args.address,
        fromBlock: args.fromBlock.toString(),
        toBlock: args.toBlock.toString(),
        topic0: args.topic0,
        page,
        offset,
        apikey: ETHERSCAN_V2_API_KEY,
      });

    const j = await fetchJsonWithBackoff(url);
    const status = String(j?.status ?? "");
    const msg = String(j?.message ?? "");
    const result = j?.result;

    if (status !== "1") {
      if (msg.toLowerCase().includes("no records")) break;
      throw new Error(`getLogs failed: ${JSON.stringify(j)}`);
    }

    if (!Array.isArray(result) || result.length === 0) break;

    out.push(...(result as EsLog[]));
    if (result.length < offset) break;

    page += 1;
    if (page > 80) break;
    await sleep(120);
  }

  return out;
}

function addChain(set: Set<ChainKey>, c: ChainKey) {
  set.add(c);
}

function hexToNumberSafe(h: string) {
  try {
    const b = BigInt(h);
    const n = Number(b);
    return Number.isFinite(n) ? n : 0;
  } catch {
    try {
      const b = BigInt(h.startsWith("0x") ? h : `0x${h}`);
      const n = Number(b);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
}

const SIG_GAME = keccak256(toHex("GameSettled(bytes32,address,bool,uint8,uint256,uint256,uint256,uint256,bytes32,bytes32,uint256)")) as `0x${string}`;
const SIG_BOUND = keccak256(toHex("Bound(address,address,bytes32)")) as `0x${string}`;
const SIG_CLAIMED = keccak256(toHex("Claimed(uint256,address,uint256)")) as `0x${string}`;

export async function GET(req: Request) {
  try {
    if (!ETHERSCAN_V2_API_KEY) return NextResponse.json({ ok: false, error: "Missing NEXT_PUBLIC_ETHERSCAN_V2_API_KEY" }, { status: 500 });

    const url = new URL(req.url);
    const tf = parseTf(url.searchParams.get("tf"));
    const key = getKey(tf);

    const cached = readCache(key);
    if (cached) return NextResponse.json(cached, { headers: { "Cache-Control": "no-store" } });

    const { startSec, endSec } = utcRange(tf, new Date());
    const start = Math.max(0, Math.floor(startSec));
    const end = Math.max(start + 1, Math.floor(endSec));

    const agg = new Map<
      string,
      {
        chains: Set<ChainKey>;
        games: number;
        volume: bigint;
        topWin: bigint;
        profit: bigint;
        referrals: Set<string>;
        claimed: bigint;
      }
    >();

    const perChainMeta: any = {};

    for (const chainKey of Object.keys(CHAIN) as ChainKey[]) {
      const cfg = CHAIN[chainKey];

      const startBlock = tf === "all" ? 0n : await getBlockByTime(cfg.chainId, start, "after");
      const endBlock = await getBlockByTime(cfg.chainId, end, "before");

      const sb = startBlock ?? 0n;
      const eb = endBlock ?? 0n;

      if (eb < sb) {
        perChainMeta[chainKey] = { chainId: cfg.chainId, startBlock: sb.toString(), endBlock: eb.toString(), logs: { game: 0, bound: 0, claimed: 0 } };
        continue;
      }

      const gameLogs = await getLogsByAddressAndTopic0({ chainId: cfg.chainId, address: cfg.game, fromBlock: sb, toBlock: eb, topic0: SIG_GAME });
      const boundLogs = await getLogsByAddressAndTopic0({ chainId: cfg.chainId, address: cfg.registry, fromBlock: sb, toBlock: eb, topic0: SIG_BOUND });
      const claimedLogs = await getLogsByAddressAndTopic0({ chainId: cfg.chainId, address: cfg.registry, fromBlock: sb, toBlock: eb, topic0: SIG_CLAIMED });

      let gameCount = 0;
      let boundCount = 0;
      let claimedCount = 0;

      for (const log of gameLogs) {
        const ts = hexToNumberSafe(log.timeStamp);
        if (ts < start || ts >= end) continue;

        let decoded: any;
        try {
          decoded = decodeEventLog({
            abi: GAME_ABI,
            data: log.data as `0x${string}`,
            topics: log.topics as readonly `0x${string}`[],
          });
        } catch {
          continue;
        }

        if (decoded?.eventName !== "GameSettled") continue;

        const player = String(decoded.args.player || "").toLowerCase();
        if (!player.startsWith("0x")) continue;

        const amountReceived = BigInt(decoded.args.amountReceived as bigint);
        const playerNetWin = BigInt(decoded.args.playerNetWin as bigint);

        if (!agg.has(player)) {
          agg.set(player, { chains: new Set<ChainKey>(), games: 0, volume: 0n, topWin: 0n, profit: 0n, referrals: new Set<string>(), claimed: 0n });
        }

        const a = agg.get(player)!;
        addChain(a.chains, chainKey);
        a.games += 1;
        a.volume += amountReceived;
        if (playerNetWin > a.topWin) a.topWin = playerNetWin;
        a.profit += playerNetWin;

        gameCount += 1;
      }

      for (const log of boundLogs) {
        const ts = hexToNumberSafe(log.timeStamp);
        if (ts < start || ts >= end) continue;

        let decoded: any;
        try {
          decoded = decodeEventLog({
            abi: REG_ABI,
            data: log.data as `0x${string}`,
            topics: log.topics as readonly `0x${string}`[],
          });
        } catch {
          continue;
        }

        if (decoded?.eventName !== "Bound") continue;

        const player = String(decoded.args.player || "").toLowerCase();
        const referrer = String(decoded.args.referrer || "").toLowerCase();
        if (!player.startsWith("0x")) continue;
        if (!referrer.startsWith("0x")) continue;

        if (!agg.has(referrer)) {
          agg.set(referrer, { chains: new Set<ChainKey>(), games: 0, volume: 0n, topWin: 0n, profit: 0n, referrals: new Set<string>(), claimed: 0n });
        }

        const a = agg.get(referrer)!;
        addChain(a.chains, chainKey);
        a.referrals.add(player);

        boundCount += 1;
      }

      for (const log of claimedLogs) {
        const ts = hexToNumberSafe(log.timeStamp);
        if (ts < start || ts >= end) continue;

        let decoded: any;
        try {
          decoded = decodeEventLog({
            abi: REG_ABI,
            data: log.data as `0x${string}`,
            topics: log.topics as readonly `0x${string}`[],
          });
        } catch {
          continue;
        }

        if (decoded?.eventName !== "Claimed") continue;

        const referrer = String(decoded.args.referrer || "").toLowerCase();
        if (!referrer.startsWith("0x")) continue;

        const amount = BigInt(decoded.args.amount as bigint);

        if (!agg.has(referrer)) {
          agg.set(referrer, { chains: new Set<ChainKey>(), games: 0, volume: 0n, topWin: 0n, profit: 0n, referrals: new Set<string>(), claimed: 0n });
        }

        const a = agg.get(referrer)!;
        addChain(a.chains, chainKey);
        a.claimed += amount;

        claimedCount += 1;
      }

      perChainMeta[chainKey] = {
        chainId: cfg.chainId,
        startBlock: sb.toString(),
        endBlock: eb.toString(),
        logs: { game: gameCount, bound: boundCount, claimed: claimedCount },
      };
    }

    const rows: ApiRow[] = [];
    for (const [address, a] of agg.entries()) {
      const chains = Array.from(a.chains);
      if (chains.length === 0) continue;

      rows.push({
        chains,
        address: address as `0x${string}`,
        games: a.games,
        volumeDtc: toDtc2(a.volume),
        topWinDtc: toDtc2(a.topWin),
        profitDtc: toDtc2(a.profit),
        referrals: a.referrals.size,
        claimedDtc: toDtc2(a.claimed),
      });
    }

    const payload = {
      ok: true,
      tf,
      rows,
      meta: {
        source: "etherscan-v2-logs",
        cached: false,
        asOfMs: nowMs(),
        utc: { startSec: start, endSec: end },
        perChain: perChainMeta,
      },
    };

    writeCache(key, payload, ttlMs(tf));
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}