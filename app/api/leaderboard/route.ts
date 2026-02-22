import { NextResponse } from "next/server";
import { createPublicClient, decodeEventLog, http, type Abi } from "viem";

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

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

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
    type: "event",
    name: "GameSettled",
    inputs: [
      { indexed: true, name: "gameId", type: "bytes32" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "won", type: "bool" },
      { indexed: false, name: "cashoutHop", type: "uint8" },
      { indexed: false, name: "amountReceived", type: "uint256" },
      { indexed: false, name: "payout", type: "uint256" },
      { indexed: false, name: "houseProfit", type: "uint256" },
      { indexed: false, name: "playerNetWin", type: "uint256" },
      { indexed: false, name: "userCommitHash", type: "bytes32" },
      { indexed: false, name: "randAnchor", type: "bytes32" },
      { indexed: false, name: "settledAt", type: "uint256" },
    ],
  },
] as const satisfies Abi;

const REG_ABI = [
  {
    type: "event",
    name: "Bound",
    inputs: [
      { indexed: true, name: "player", type: "address" },
      { indexed: true, name: "referrer", type: "address" },
      { indexed: true, name: "code", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { indexed: true, name: "epochId", type: "uint256" },
      { indexed: true, name: "referrer", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const satisfies Abi;

type Client = ReturnType<typeof createPublicClient>;

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

function getBlockTsCache(): Map<string, Map<bigint, number>> {
  const g = globalThis as any;
  if (!g.__LB_BLOCK_TS__) g.__LB_BLOCK_TS__ = new Map<string, Map<bigint, number>>();
  return g.__LB_BLOCK_TS__;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3) {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      await sleep(200 * (i + 1));
    }
  }
  throw last;
}

async function getBlockTimestamp(client: Client, chainKey: ChainKey, blockNumber: bigint): Promise<number> {
  const c = getBlockTsCache();
  if (!c.get(chainKey)) c.set(chainKey, new Map());
  const m = c.get(chainKey)!;
  const hit = m.get(blockNumber);
  if (typeof hit === "number") return hit;

  const blk = await withRetry(() => client.getBlock({ blockNumber }));
  const ts = Number(blk.timestamp);
  m.set(blockNumber, ts);
  return ts;
}

async function findBlockByTimestamp(client: Client, chainKey: ChainKey, targetSec: number, side: "lte" | "gte") {
  const latest = await withRetry(() => client.getBlockNumber());
  let lo = 0n;
  let hi = latest;
  let ans = side === "lte" ? 0n : latest;

  while (lo <= hi) {
    const mid = (lo + hi) / 2n;
    const ts = await getBlockTimestamp(client, chainKey, mid);
    if (ts === targetSec) return mid;

    if (ts < targetSec) {
      if (side === "lte") ans = mid;
      lo = mid + 1n;
    } else {
      if (side === "gte") ans = mid;
      if (mid === 0n) break;
      hi = mid - 1n;
    }
  }

  return ans;
}

async function getLogsPaged(client: Client, args: { address: `0x${string}`; fromBlock: bigint; toBlock: bigint }) {
  let span = 5000n;
  const out: any[] = [];
  let from = args.fromBlock;
  const to = args.toBlock;

  while (from <= to) {
    const end = from + span > to ? to : from + span;

    try {
      const logs = await withRetry(() =>
        client.getLogs({
          address: args.address,
          fromBlock: from,
          toBlock: end,
        })
      );
      out.push(...logs);
      from = end + 1n;
    } catch {
      if (span <= 500n) throw new Error("RPC getLogs failed even at small span");
      span = span / 2n;
    }
  }

  return out;
}

function addChain(set: Set<ChainKey>, c: ChainKey) {
  set.add(c);
}

async function getProviderClient() {
  const rpcUrl = `https://api.etherscan.io/api?module=logs&action=getLogs&apikey=${ETHERSCAN_API_KEY}`;
  const client = createPublicClient({ transport: http(rpcUrl) });
  return client;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tf = parseTf(url.searchParams.get("tf"));
    const key = getKey(tf);

    const cached = readCache(key);
    if (cached) {
      return NextResponse.json(cached, { headers: { "Cache-Control": "no-store" } });
    }

    const origin = url.origin;

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
    const client = await getProviderClient();

    const rows: ApiRow[] = []; // Initialize rows

    const payload = {
      ok: true,
      tf,
      rows,
      meta: {
        source: "rpc-logs",
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