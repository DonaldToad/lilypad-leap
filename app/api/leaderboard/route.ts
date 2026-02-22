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

const CHAIN: Record<
  ChainKey,
  {
    chainId: number;
    game: `0x${string}`;
    registry: `0x${string}`;
    blockscoutApi?: string;
    rpcs: string[];
    avgBlockTimeSec: number;
  }
> = {
  base: {
    chainId: 8453,
    game: "0x05df07E37B8dF836549B28AA3195FD54D57DD845",
    registry: "0x994a28Bb8d84AacB691bA8773e81dAFC1acEb39B",
    blockscoutApi: "https://base.blockscout.com/api",
    rpcs: ["https://base-rpc.publicnode.com", "https://1rpc.io/base", "https://rpc.ankr.com/base"],
    avgBlockTimeSec: 2,
  },
  linea: {
    chainId: 59144,
    game: "0x5Eb6920Af0163e749274619E8076666885Bf0B57",
    registry: "0xAbD4c0dF150025a1982FC8236e5880EcC9156BeE",
    rpcs: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://1rpc.io/linea"],
    avgBlockTimeSec: 3,
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

const TOPIC_GAME_SETTLED = keccak256(
  toHex("GameSettled(bytes32,address,bool,uint8,uint256,uint256,uint256,uint256,bytes32,bytes32,uint256)"),
);
const TOPIC_BOUND = keccak256(toHex("Bound(address,address,bytes32)"));
const TOPIC_CLAIMED = keccak256(toHex("Claimed(uint256,address,uint256)"));

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

function jitter(ms: number) {
  const j = Math.floor(Math.random() * 120);
  return ms + j;
}

async function fetchTextWithBackoff(url: string, init?: RequestInit, tries = 4) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, init);
    last = await res.text();
    if (res.ok) return last;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw new Error(`HTTP ${res.status}: ${last}`);
    await sleep(jitter(Math.min(1200, 200 * 2 ** i)));
  }
  throw new Error(`HTTP request failed: ${last}`);
}

async function fetchJsonWithBackoff(url: string, init?: RequestInit, tries = 4) {
  const t = await fetchTextWithBackoff(url, init, tries);
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

async function blockscoutGetBlockByTime(apiBase: string, timestampSec: number, closest: "before" | "after") {
  const u = new URL(apiBase);
  u.searchParams.set("module", "block");
  u.searchParams.set("action", "getblocknobytime");
  u.searchParams.set("timestamp", String(timestampSec));
  u.searchParams.set("closest", closest);

  const j = await fetchJsonWithBackoff(u.toString(), undefined, 4);

  const status = String((j as any)?.status ?? "");
  const result = (j as any)?.result;

  if (status !== "1") throw new Error(`getblocknobytime failed: ${JSON.stringify(j)}`);

  let s: string | null = null;

  if (typeof result === "string") s = result;
  else if (typeof result === "number") s = String(result);
  else if (result && typeof result === "object") {
    const r: any = result;
    if (typeof r.blockNumber === "string") s = r.blockNumber;
    else if (typeof r.block_number === "string") s = r.block_number;
    else if (typeof r.result === "string") s = r.result;
  }

  if (!s || !/^\d+$/.test(s)) throw new Error(`getblocknobytime bad result shape: ${JSON.stringify(j)}`);

  const bn = BigInt(s);
  return bn < 0n ? 0n : bn;
}

async function blockscoutGetLogsOnce(args: {
  apiBase: string;
  address: `0x${string}`;
  fromBlock: bigint;
  toBlock: bigint;
  topic0: `0x${string}`;
}) {
  const u = new URL(args.apiBase);
  u.searchParams.set("module", "logs");
  u.searchParams.set("action", "getLogs");
  u.searchParams.set("fromBlock", args.fromBlock.toString());
  u.searchParams.set("toBlock", args.toBlock.toString());
  u.searchParams.set("address", args.address);
  u.searchParams.set("topic0", args.topic0);
  u.searchParams.set("page", "1");
  u.searchParams.set("offset", "1000");

  const j = await fetchJsonWithBackoff(u.toString(), undefined, 4);
  const status = String((j as any)?.status ?? "");
  const result = (j as any)?.result;

  if (status !== "1") {
    const msg = String((j as any)?.message ?? "");
    if (msg.toLowerCase().includes("no records") || msg.toLowerCase().includes("no result")) return [];
    if (Array.isArray(result) && result.length === 0) return [];
    throw new Error(`getLogs failed: ${JSON.stringify(j)}`);
  }

  if (!Array.isArray(result)) return [];
  return result;
}

function normalizeTopics(x: any): `0x${string}`[] {
  if (Array.isArray(x)) return x.filter((t) => typeof t === "string" && t.startsWith("0x")) as any;
  const out: string[] = [];
  const t0 = x?.topic0;
  const t1 = x?.topic1;
  const t2 = x?.topic2;
  const t3 = x?.topic3;
  for (const t of [t0, t1, t2, t3]) if (typeof t === "string" && t.startsWith("0x")) out.push(t);
  return out as any;
}

function asBigInt(x: any): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  if (typeof x === "string") return BigInt(x);
  if (x && typeof x === "object") {
    const h1 = (x as any).hex;
    if (typeof h1 === "string" && h1.startsWith("0x")) return BigInt(h1);
    const h2 = (x as any)._hex;
    if (typeof h2 === "string" && h2.startsWith("0x")) return BigInt(h2);
    const b1 = (x as any).bigint;
    if (typeof b1 === "bigint") return b1;
    const v1 = (x as any).value;
    if (typeof v1 === "string" || typeof v1 === "number" || typeof v1 === "bigint") return BigInt(v1 as any);
  }
  throw new Error(`Cannot convert [object Object] to a BigInt`);
}

let RPC_ID = 1;

async function rpcCall(rpc: string, method: string, params: any[]) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: (RPC_ID = (RPC_ID % 1_000_000) + 1), method, params });
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${text}`);
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`RPC non-JSON: ${text}`);
  }
  if (j?.error) throw new Error(j.error?.message ? String(j.error.message) : JSON.stringify(j.error));
  return j?.result;
}

async function rpcTry<T>(rpcs: string[], fn: (rpc: string) => Promise<T>) {
  let lastErr: any = null;
  for (const rpc of rpcs) {
    try {
      return await fn(rpc);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("All RPCs failed");
}

function hexToBigInt(h: any): bigint {
  if (typeof h !== "string" || !h.startsWith("0x")) throw new Error("bad hex");
  return BigInt(h);
}

async function rpcLatestBlockNumber(rpcs: string[]) {
  const hex = await rpcTry(rpcs, (rpc) => rpcCall(rpc, "eth_blockNumber", []));
  return hexToBigInt(hex);
}

type BlockCache = Map<string, number>;

async function rpcBlockTimestamp(rpcs: string[], block: bigint, cache: BlockCache) {
  const key = block.toString();
  const hit = cache.get(key);
  if (typeof hit === "number") return hit;

  const hexBlock = "0x" + block.toString(16);
  const b = await rpcTry(rpcs, (rpc) => rpcCall(rpc, "eth_getBlockByNumber", [hexBlock, false]));
  const tsHex = (b as any)?.timestamp;
  if (typeof tsHex !== "string" || !tsHex.startsWith("0x")) throw new Error("bad block timestamp");
  const ts = Number(BigInt(tsHex));
  cache.set(key, ts);
  return ts;
}

async function rpcFindBlockByTimeFast(
  rpcs: string[],
  targetTs: number,
  closest: "before" | "after",
  avgBlockTimeSec: number,
) {
  const cache: BlockCache = new Map();

  const latest = await rpcLatestBlockNumber(rpcs);
  const latestTs = await rpcBlockTimestamp(rpcs, latest, cache);

  if (targetTs <= 0) return 0n;
  if (targetTs >= latestTs) return latest;

  const dt = latestTs - targetTs;
  const estBack = Math.max(0, Math.floor(dt / Math.max(1, avgBlockTimeSec)));
  let est = latest - BigInt(estBack);

  if (est < 0n) est = 0n;
  if (est > latest) est = latest;

  let lo = est > 50_000n ? est - 50_000n : 0n;
  let hi = est + 50_000n;
  if (hi > latest) hi = latest;

  let best: bigint | null = null;

  for (let i = 0; i < 28 && lo <= hi; i++) {
    const mid = (lo + hi) / 2n;
    const midTs = await rpcBlockTimestamp(rpcs, mid, cache);

    if (midTs === targetTs) {
      best = mid;
      break;
    }

    if (midTs < targetTs) {
      if (closest === "before") best = mid;
      lo = mid + 1n;
    } else {
      if (closest === "after") best = mid;
      if (mid === 0n) break;
      hi = mid - 1n;
    }
  }

  if (best === null) return closest === "after" ? 0n : latest;
  return best < 0n ? 0n : best;
}

async function rpcGetLogsRange(rpcs: string[], filter: any) {
  const res = await rpcTry(rpcs, (rpc) => rpcCall(rpc, "eth_getLogs", [filter]));
  if (!Array.isArray(res)) return [];
  return res;
}

function isTooManyResultsError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("query returned more than") ||
    m.includes("more than") ||
    m.includes("response size exceeded") ||
    m.includes("exceeds limit") ||
    m.includes("too large") ||
    m.includes("log response size exceeded")
  );
}

async function rpcGetLogsSplit(
  rpcs: string[],
  baseFilter: { address: string; topics: string[]; fromBlock: string; toBlock: string },
  depth = 0,
): Promise<any[]> {
  try {
    return await rpcGetLogsRange(rpcs, baseFilter);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (!isTooManyResultsError(msg) || depth >= 16) throw e;

    const from = BigInt(baseFilter.fromBlock);
    const to = BigInt(baseFilter.toBlock);
    if (to <= from) return [];

    const mid = (from + to) / 2n;
    const left = { ...baseFilter, toBlock: "0x" + mid.toString(16) };
    const right = { ...baseFilter, fromBlock: "0x" + (mid + 1n).toString(16) };

    const a = await rpcGetLogsSplit(rpcs, left, depth + 1);
    await sleep(jitter(30));
    const b = await rpcGetLogsSplit(rpcs, right, depth + 1);
    return a.concat(b);
  }
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
    const perChainErrors: any = {};
    let okChains = 0;

    for (const chainKey of Object.keys(CHAIN) as ChainKey[]) {
      const cfg = CHAIN[chainKey];

      try {
        let fromBlock = 0n;
        let toBlock = 0n;
        let method: "blockscout" | "rpc" = "rpc";

        if (chainKey === "base" && cfg.blockscoutApi) {
          method = "blockscout";
          fromBlock = tf === "all" ? 0n : await blockscoutGetBlockByTime(cfg.blockscoutApi, start, "after");
          toBlock = tf === "all" ? 99_999_999n : await blockscoutGetBlockByTime(cfg.blockscoutApi, end, "before");
        } else {
          method = "rpc";
          fromBlock =
            tf === "all" ? 0n : await rpcFindBlockByTimeFast(cfg.rpcs, start, "after", cfg.avgBlockTimeSec);
          toBlock =
            tf === "all"
              ? await rpcLatestBlockNumber(cfg.rpcs)
              : await rpcFindBlockByTimeFast(cfg.rpcs, end, "before", cfg.avgBlockTimeSec);
        }

        if (toBlock < fromBlock) {
          const tmp = fromBlock;
          fromBlock = toBlock;
          toBlock = tmp;
        }

        let gameLogs: any[] = [];
        let boundLogs: any[] = [];
        let claimedLogs: any[] = [];

        if (method === "blockscout" && cfg.blockscoutApi) {
          gameLogs = await blockscoutGetLogsOnce({
            apiBase: cfg.blockscoutApi,
            address: cfg.game,
            fromBlock,
            toBlock,
            topic0: TOPIC_GAME_SETTLED as `0x${string}`,
          });

          boundLogs = await blockscoutGetLogsOnce({
            apiBase: cfg.blockscoutApi,
            address: cfg.registry,
            fromBlock,
            toBlock,
            topic0: TOPIC_BOUND as `0x${string}`,
          });

          claimedLogs = await blockscoutGetLogsOnce({
            apiBase: cfg.blockscoutApi,
            address: cfg.registry,
            fromBlock,
            toBlock,
            topic0: TOPIC_CLAIMED as `0x${string}`,
          });
        } else {
          const fromHex = "0x" + fromBlock.toString(16);
          const toHex = "0x" + toBlock.toString(16);

          gameLogs = await rpcGetLogsSplit(cfg.rpcs, {
            address: cfg.game,
            topics: [TOPIC_GAME_SETTLED],
            fromBlock: fromHex,
            toBlock: toHex,
          });
          await sleep(jitter(40));
          boundLogs = await rpcGetLogsSplit(cfg.rpcs, {
            address: cfg.registry,
            topics: [TOPIC_BOUND],
            fromBlock: fromHex,
            toBlock: toHex,
          });
          await sleep(jitter(40));
          claimedLogs = await rpcGetLogsSplit(cfg.rpcs, {
            address: cfg.registry,
            topics: [TOPIC_CLAIMED],
            fromBlock: fromHex,
            toBlock: toHex,
          });
        }

        let gameCount = 0;
        let boundCount = 0;
        let claimedCount = 0;

        for (const l of gameLogs) {
          const topics = normalizeTopics((l as any).topics ?? l);
          const data = String((l as any).data ?? "0x") as `0x${string}`;

          let decoded: any;
          try {
            decoded = decodeEventLog({ abi: GAME_ABI, data, topics: topics as any });
          } catch {
            continue;
          }
          if (decoded?.eventName !== "GameSettled") continue;

          const player = String((decoded.args as any).player || "").toLowerCase();
          if (!player.startsWith("0x") || player.length !== 42) continue;

          const amountReceived = asBigInt((decoded.args as any).amountReceived);
          const playerNetWin = asBigInt((decoded.args as any).playerNetWin);

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

        for (const l of boundLogs) {
          const topics = normalizeTopics((l as any).topics ?? l);
          const data = String((l as any).data ?? "0x") as `0x${string}`;

          let decoded: any;
          try {
            decoded = decodeEventLog({ abi: REG_ABI, data, topics: topics as any });
          } catch {
            continue;
          }
          if (decoded?.eventName !== "Bound") continue;

          const player = String((decoded.args as any).player || "").toLowerCase();
          const referrer = String((decoded.args as any).referrer || "").toLowerCase();
          if (!player.startsWith("0x") || player.length !== 42) continue;
          if (!referrer.startsWith("0x") || referrer.length !== 42) continue;

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

        for (const l of claimedLogs) {
          const topics = normalizeTopics((l as any).topics ?? l);
          const data = String((l as any).data ?? "0x") as `0x${string}`;

          let decoded: any;
          try {
            decoded = decodeEventLog({ abi: REG_ABI, data, topics: topics as any });
          } catch {
            continue;
          }
          if (decoded?.eventName !== "Claimed") continue;

          const referrer = String((decoded.args as any).referrer || "").toLowerCase();
          if (!referrer.startsWith("0x") || referrer.length !== 42) continue;

          const amount = asBigInt((decoded.args as any).amount);

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

        perChainMeta[chainKey] = {
          method,
          rpcs: cfg.rpcs,
          blockscout: cfg.blockscoutApi,
          startBlock: fromBlock.toString(),
          endBlock: toBlock.toString(),
          logs: { game: gameCount, bound: boundCount, claimed: claimedCount },
        };

        okChains += 1;
      } catch (e: any) {
        perChainErrors[chainKey] = String(e?.message ?? e);
        perChainMeta[chainKey] = { rpcs: cfg.rpcs, blockscout: cfg.blockscoutApi };
      }
    }

    if (okChains === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "All chains failed",
          tf,
          meta: {
            source: "blockscout+rpc",
            asOfMs: nowMs(),
            utc: { startSec: start, endSec: end },
            perChain: perChainMeta,
            errors: perChainErrors,
          },
        },
        { status: 500 },
      );
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
        source: "blockscout+rpc",
        cached: false,
        asOfMs: nowMs(),
        utc: { startSec: start, endSec: end },
        perChain: perChainMeta,
        errors: Object.keys(perChainErrors).length ? perChainErrors : undefined,
      },
    };

    writeCache(key, payload, ttlMs(tf));
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}