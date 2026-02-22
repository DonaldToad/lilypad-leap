// app/api/leaderboard/route.ts
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
    blockscoutApi?: string | null;
    rpcs: string[];
  }
> = {
  base: {
    chainId: 8453,
    game: "0x05df07E37B8dF836549B28AA3195FD54D57DD845",
    registry: "0x994a28Bb8d84AacB691bA8773e81dAFC1acEb39B",
    blockscoutApi: "https://base.blockscout.com/api",
    rpcs: ["https://base-rpc.publicnode.com", "https://1rpc.io/base", "https://rpc.ankr.com/base"],
  },
  linea: {
    chainId: 59144,
    game: "0x5Eb6920Af0163e749274619E8076666885Bf0B57",
    registry: "0xAbD4c0dF150025a1982FC8236e5880EcC9156BeE",
    blockscoutApi: null,
    rpcs: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://1rpc.io/linea"],
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

async function fetchJsonWithBackoff(url: string, init?: RequestInit, tries = 6) {
  let lastText = "";
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, init);
    const text = await res.text();
    lastText = text;
    if (res.ok) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw new Error(`HTTP ${res.status}: ${text}`);
    const wait = jitter(Math.min(3000, 250 * 2 ** i));
    await sleep(wait);
  }
  throw new Error(`HTTP request failed: ${lastText}`);
}

async function blockscoutGetBlockByTime(apiBase: string, timestampSec: number, closest: "before" | "after") {
  const u = new URL(apiBase);
  u.searchParams.set("module", "block");
  u.searchParams.set("action", "getblocknobytime");
  u.searchParams.set("timestamp", String(timestampSec));
  u.searchParams.set("closest", closest);

  const j = await fetchJsonWithBackoff(u.toString(), undefined, 6);

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

async function blockscoutGetLogsPaged(args: {
  apiBase: string;
  address: `0x${string}`;
  fromBlock: bigint;
  toBlock: bigint;
  topic0: `0x${string}`;
  pageLimit?: number;
}) {
  const offset = 1000;
  const maxPages = args.pageLimit ?? 50;
  const out: any[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(args.apiBase);
    u.searchParams.set("module", "logs");
    u.searchParams.set("action", "getLogs");
    u.searchParams.set("fromBlock", args.fromBlock.toString());
    u.searchParams.set("toBlock", args.toBlock.toString());
    u.searchParams.set("address", args.address);
    u.searchParams.set("topic0", args.topic0);
    u.searchParams.set("page", String(page));
    u.searchParams.set("offset", String(offset));

    const j = await fetchJsonWithBackoff(u.toString(), undefined, 6);
    const status = String((j as any)?.status ?? "");
    const result = (j as any)?.result;

    if (status !== "1") {
      const msg = String((j as any)?.message ?? "");
      if (msg.toLowerCase().includes("no records") || msg.toLowerCase().includes("no result")) break;
      if (Array.isArray(result) && result.length === 0) break;
      throw new Error(`getLogs failed: ${JSON.stringify(j)}`);
    }

    if (!Array.isArray(result)) break;

    out.push(...result);

    if (result.length < offset) break;
    await sleep(jitter(80));
  }

  return out;
}

function isRetryableRpcErrorMessage(s: string) {
  const t = s.toLowerCase();
  return (
    t.includes("too many") ||
    t.includes("rate") ||
    t.includes("timeout") ||
    t.includes("temporar") ||
    t.includes("overloaded") ||
    t.includes("server error") ||
    t.includes("subrequest") ||
    t.includes("gateway") ||
    t.includes("network")
  );
}

async function rpcCall(url: string, method: string, params: any[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON: ${text}`);
  }
  if (j?.error) throw new Error(j.error?.message ? String(j.error.message) : JSON.stringify(j.error));
  return j?.result;
}

async function rpcCallWithFallback(rpcs: string[], method: string, params: any[], triesPerRpc = 2) {
  let lastErr: any = null;
  for (const rpc of rpcs) {
    for (let t = 0; t < triesPerRpc; t++) {
      try {
        return await rpcCall(rpc, method, params);
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message ?? e);
        if (!isRetryableRpcErrorMessage(msg)) break;
        await sleep(jitter(Math.min(1500, 150 * 2 ** t)));
      }
    }
  }
  throw lastErr ?? new Error("RPC failed");
}

function hexBlock(n: bigint) {
  return "0x" + n.toString(16);
}

function hexToBigInt(x: any) {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  if (typeof x === "string") {
    if (x.startsWith("0x")) return BigInt(x);
    return BigInt(x);
  }
  if (x && typeof x === "object") {
    const h = (x as any).hex;
    if (typeof h === "string") return BigInt(h);
  }
  throw new Error(`Bad bigint: ${String(x)}`);
}

function hexToNumber(x: any) {
  const b = hexToBigInt(x);
  if (b > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Number overflow");
  return Number(b);
}

async function rpcGetLatestBlockNumber(rpcs: string[]) {
  const bnHex = await rpcCallWithFallback(rpcs, "eth_blockNumber", []);
  return hexToBigInt(bnHex);
}

async function rpcGetBlockTimestamp(rpcs: string[], blockNumber: bigint, cache: Map<string, number>) {
  const k = blockNumber.toString();
  const hit = cache.get(k);
  if (hit != null) return hit;
  const b = await rpcCallWithFallback(rpcs, "eth_getBlockByNumber", [hexBlock(blockNumber), false]);
  const ts = hexToNumber(b?.timestamp);
  cache.set(k, ts);
  return ts;
}

async function rpcFindBlockByTime(
  rpcs: string[],
  targetSec: number,
  mode: "after" | "before",
  latestBlock: bigint,
  tsCache: Map<string, number>,
) {
  let lo = 0n;
  let hi = latestBlock;
  let ans = mode === "after" ? latestBlock : 0n;

  for (let i = 0; i < 40; i++) {
    if (lo > hi) break;
    const mid = (lo + hi) / 2n;
    const ts = await rpcGetBlockTimestamp(rpcs, mid, tsCache);

    if (ts === targetSec) {
      ans = mid;
      if (mode === "after") hi = mid - 1n;
      else lo = mid + 1n;
      continue;
    }

    if (ts < targetSec) {
      lo = mid + 1n;
      if (mode === "before") ans = mid;
    } else {
      hi = mid - 1n;
      if (mode === "after") ans = mid;
    }
  }

  if (ans < 0n) ans = 0n;
  if (ans > latestBlock) ans = latestBlock;
  return ans;
}

async function rpcGetLogsChunked(args: {
  rpcs: string[];
  address: `0x${string}`;
  fromBlock: bigint;
  toBlock: bigint;
  topic0: `0x${string}`;
}) {
  const out: any[] = [];
  if (args.toBlock < args.fromBlock) return out;

  let cursor = args.fromBlock;
  let step = 2000n;
  const minStep = 50n;
  const maxStep = 5000n;

  while (cursor <= args.toBlock) {
    const end = cursor + step - 1n > args.toBlock ? args.toBlock : cursor + step - 1n;

    try {
      const logs = await rpcCallWithFallback(args.rpcs, "eth_getLogs", [
        {
          address: args.address,
          fromBlock: hexBlock(cursor),
          toBlock: hexBlock(end),
          topics: [args.topic0],
        },
      ]);

      if (Array.isArray(logs)) out.push(...logs);

      cursor = end + 1n;
      if (step < maxStep) step = step + step / 2n;
      await sleep(jitter(30));
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (isRetryableRpcErrorMessage(msg) && step > minStep) {
        step = step / 2n;
        if (step < minStep) step = minStep;
        await sleep(jitter(120));
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

        const usingBlockscout = !!cfg.blockscoutApi;

        if (tf === "all") {
          if (usingBlockscout) {
            fromBlock = 0n;
            toBlock = 99_999_999n;
          } else {
            const latest = await rpcGetLatestBlockNumber(cfg.rpcs);
            fromBlock = 0n;
            toBlock = latest;
          }
        } else if (usingBlockscout) {
          fromBlock = await blockscoutGetBlockByTime(cfg.blockscoutApi!, start, "after");
          toBlock = await blockscoutGetBlockByTime(cfg.blockscoutApi!, end, "before");
        } else {
          const latest = await rpcGetLatestBlockNumber(cfg.rpcs);
          const tsCache = new Map<string, number>();
          fromBlock = await rpcFindBlockByTime(cfg.rpcs, start, "after", latest, tsCache);
          toBlock = await rpcFindBlockByTime(cfg.rpcs, end, "before", latest, tsCache);
        }

        let gameLogs: any[] = [];
        let boundLogs: any[] = [];
        let claimedLogs: any[] = [];
        let method: "blockscout" | "rpc" = "rpc";

        if (usingBlockscout) {
          method = "blockscout";
          gameLogs = await blockscoutGetLogsPaged({
            apiBase: cfg.blockscoutApi!,
            address: cfg.game,
            fromBlock,
            toBlock,
            topic0: TOPIC_GAME_SETTLED as `0x${string}`,
            pageLimit: tf === "all" ? 120 : 25,
          });

          boundLogs = await blockscoutGetLogsPaged({
            apiBase: cfg.blockscoutApi!,
            address: cfg.registry,
            fromBlock,
            toBlock,
            topic0: TOPIC_BOUND as `0x${string}`,
            pageLimit: tf === "all" ? 120 : 25,
          });

          claimedLogs = await blockscoutGetLogsPaged({
            apiBase: cfg.blockscoutApi!,
            address: cfg.registry,
            fromBlock,
            toBlock,
            topic0: TOPIC_CLAIMED as `0x${string}`,
            pageLimit: tf === "all" ? 120 : 25,
          });
        } else {
          method = "rpc";
          gameLogs = await rpcGetLogsChunked({
            rpcs: cfg.rpcs,
            address: cfg.game,
            fromBlock,
            toBlock,
            topic0: TOPIC_GAME_SETTLED as `0x${string}`,
          });

          boundLogs = await rpcGetLogsChunked({
            rpcs: cfg.rpcs,
            address: cfg.registry,
            fromBlock,
            toBlock,
            topic0: TOPIC_BOUND as `0x${string}`,
          });

          claimedLogs = await rpcGetLogsChunked({
            rpcs: cfg.rpcs,
            address: cfg.registry,
            fromBlock,
            toBlock,
            topic0: TOPIC_CLAIMED as `0x${string}`,
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
          blockscout: cfg.blockscoutApi ?? undefined,
          startBlock: fromBlock.toString(),
          endBlock: toBlock.toString(),
          logs: { game: gameCount, bound: boundCount, claimed: claimedCount },
        };

        okChains += 1;
      } catch (e: any) {
        perChainErrors[chainKey] = String(e?.message ?? e);
        perChainMeta[chainKey] = {
          rpcs: cfg.rpcs,
          blockscout: cfg.blockscoutApi ?? undefined,
        };
      }
    }

    if (okChains === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "All chains failed",
          tf,
          meta: {
            source: "blockscout+rpc-logs",
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
        source: "blockscout+rpc-logs",
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