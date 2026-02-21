import { NextResponse } from "next/server";
import {
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  http,
  type Abi,
  type Hex,
} from "viem";

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errStr(e: any) {
  return String(e?.shortMessage || e?.message || e);
}

function looksLikeRateLimit(msg: string) {
  const s = msg.toLowerCase();
  return s.includes("429") || s.includes("rate") || s.includes("too many requests") || s.includes("over rate limit");
}

function looksLikeRangeTooBig(msg: string) {
  const s = msg.toLowerCase();
  return (
    s.includes("query returned more than") ||
    s.includes("more than") && s.includes("results") ||
    s.includes("block range") ||
    s.includes("range too") ||
    s.includes("response size") ||
    s.includes("limit exceeded")
  );
}

async function withRetry<T>(fn: () => Promise<T>, tries = 5) {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const msg = errStr(e);
      const base = looksLikeRateLimit(msg) ? 600 : 250;
      await sleep(base * (i + 1));
    }
  }
  throw last;
}

async function findBlockByTimestamp(client: Client, targetSec: number, side: "lte" | "gte") {
  const latest = await withRetry(() => client.getBlockNumber());
  let lo = 0n;
  let hi = latest;
  let ans = side === "lte" ? 0n : latest;

  while (lo <= hi) {
    const mid = (lo + hi) / 2n;
    const blk = await withRetry(() => client.getBlock({ blockNumber: mid }));
    const ts = Number(blk.timestamp);

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

async function getLogsPaged(client: Client, args: { address: `0x${string}`; fromBlock: bigint; toBlock: bigint; topics?: Hex[] }) {
  let span = 10_000n;
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
          topics: args.topics,
        })
      );
      out.push(...logs);
      from = end + 1n;
      if (span < 10_000n) span = span + span / 2n;
      if (span > 10_000n) span = 10_000n;
    } catch (e: any) {
      const msg = errStr(e);

      if (looksLikeRateLimit(msg)) {
        await sleep(900);
        continue;
      }

      if (looksLikeRangeTooBig(msg) || span > 500n) {
        span = span / 2n;
        if (span < 250n) span = 250n;
        continue;
      }

      throw new Error(msg);
    }
  }

  return out;
}

function addChain(set: Set<ChainKey>, c: ChainKey) {
  set.add(c);
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
    const startBI = BigInt(start);
    const endBI = BigInt(end);

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

    const gameTopic0 = encodeEventTopics({ abi: GAME_ABI, eventName: "GameSettled" })[0] as Hex;
    const boundTopic0 = encodeEventTopics({ abi: REG_ABI, eventName: "Bound" })[0] as Hex;
    const claimedTopic0 = encodeEventTopics({ abi: REG_ABI, eventName: "Claimed" })[0] as Hex;

    for (const chainKey of Object.keys(CHAIN) as ChainKey[]) {
      const cfg = CHAIN[chainKey];
      const rpcProxy = `${origin}/api/rpc/${cfg.chainId}`;
      const client = createPublicClient({ transport: http(rpcProxy) });

      const startBlock = tf === "all" ? 0n : await findBlockByTimestamp(client, start, "gte");
      const endBlock = await findBlockByTimestamp(client, end, "lte");

      const gameLogs = await getLogsPaged(client, {
        address: cfg.game,
        fromBlock: startBlock,
        toBlock: endBlock,
        topics: [gameTopic0],
      });

      const regLogs = await getLogsPaged(client, {
        address: cfg.registry,
        fromBlock: startBlock,
        toBlock: endBlock,
        topics: [boundTopic0, claimedTopic0],
      });

      let gameCount = 0;
      let boundCount = 0;
      let claimedCount = 0;

      for (const log of gameLogs) {
        let decoded: any;
        try {
          decoded = decodeEventLog({ abi: GAME_ABI, data: log.data, topics: log.topics });
        } catch {
          continue;
        }
        if (decoded?.eventName !== "GameSettled") continue;

        const settledAt = BigInt(decoded.args.settledAt as bigint);
        if (settledAt < startBI || settledAt >= endBI) continue;

        const player = (decoded.args.player as string).toLowerCase();
        const amountReceived = BigInt(decoded.args.amountReceived as bigint);
        const playerNetWin = BigInt(decoded.args.playerNetWin as bigint);

        if (!agg.has(player)) {
          agg.set(player, {
            chains: new Set<ChainKey>(),
            games: 0,
            volume: 0n,
            topWin: 0n,
            profit: 0n,
            referrals: new Set<string>(),
            claimed: 0n,
          });
        }

        const a = agg.get(player)!;
        addChain(a.chains, chainKey);
        a.games += 1;
        a.volume += amountReceived;
        if (playerNetWin > a.topWin) a.topWin = playerNetWin;
        a.profit += playerNetWin;

        gameCount += 1;
      }

      for (const log of regLogs) {
        let decoded: any;
        try {
          decoded = decodeEventLog({ abi: REG_ABI, data: log.data, topics: log.topics });
        } catch {
          continue;
        }

        if (decoded?.eventName === "Bound") {
          const player = (decoded.args.player as string).toLowerCase();
          const referrer = (decoded.args.referrer as string).toLowerCase();

          if (!agg.has(referrer)) {
            agg.set(referrer, {
              chains: new Set<ChainKey>(),
              games: 0,
              volume: 0n,
              topWin: 0n,
              profit: 0n,
              referrals: new Set<string>(),
              claimed: 0n,
            });
          }

          const a = agg.get(referrer)!;
          addChain(a.chains, chainKey);
          a.referrals.add(player);
          boundCount += 1;
        }

        if (decoded?.eventName === "Claimed") {
          const referrer = (decoded.args.referrer as string).toLowerCase();
          const amount = BigInt(decoded.args.amount as bigint);

          if (!agg.has(referrer)) {
            agg.set(referrer, {
              chains: new Set<ChainKey>(),
              games: 0,
              volume: 0n,
              topWin: 0n,
              profit: 0n,
              referrals: new Set<string>(),
              claimed: 0n,
            });
          }

          const a = agg.get(referrer)!;
          addChain(a.chains, chainKey);
          a.claimed += amount;
          claimedCount += 1;
        }
      }

      perChainMeta[chainKey] = {
        rpc: rpcProxy,
        startBlock: startBlock.toString(),
        endBlock: endBlock.toString(),
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