import { NextResponse } from "next/server";
import { decodeEventLog, keccak256, toHex, type Abi } from "viem";

export const runtime = "edge";

type ChainKey = "base" | "linea";
type Timeframe = "daily" | "weekly" | "monthly" | "all";

type GameRow = {
  chain: ChainKey;
  gameId: `0x${string}`;
  won: boolean;
  cashoutHop: number;
  wagerDtc: number;
  payoutDtc: number;
  pnlDtc: number;
  txHash: `0x${string}`;
  timestamp: number; // ms
};

type ApiPayload = {
  ok: boolean;
  address: `0x${string}`;
  chain: ChainKey;
  tf: Timeframe;
  rows: GameRow[];
  meta?: any;
};

type CacheEntry = { exp: number; payload: any };

const DTC_DECIMALS = 18n;

const CHAIN: Record<
  ChainKey,
  {
    chainId: number;
    game: `0x${string}`;
    blockscoutApi?: string;
    rpcs: string[];
  }
> = {
  base: {
    chainId: 8453,
    game: "0x05df07E37B8dF836549B28AA3195FD54D57DD845",
    blockscoutApi: "https://base.blockscout.com/api",
    rpcs: ["https://base-rpc.publicnode.com", "https://1rpc.io/base", "https://rpc.ankr.com/base"],
  },
  linea: {
    chainId: 59144,
    game: "0x5Eb6920Af0163e749274619E8076666885Bf0B57",
    rpcs: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://1rpc.io/linea"],
  },
};

const GAME_ABI = [
  {
    type: "event",
    name: "GameSettled",
    inputs: [
      { indexed: true, name: "gameId", type: "bytes32" }, // topic1
      { indexed: true, name: "player", type: "address" }, // topic2
      { indexed: false, name: "won", type: "bool" },
      { indexed: false, name: "cashoutHop", type: "uint8" },
      { indexed: false, name: "amountReceived", type: "uint256" },
      { indexed: false, name: "payout", type: "uint256" },
      { indexed: false, name: "houseProfit", type: "uint256" },
      { indexed: false, name: "playerNetWin", type: "uint256" },
      { indexed: false, name: "userCommitHash", type: "bytes32" },
      { indexed: false, name: "randAnchor", type: "bytes32" },
      { indexed: false, name: "settledAt", type: "uint256" }, // seconds
    ],
  },
] as const satisfies Abi;

const TOPIC_GAME_SETTLED = keccak256(
  toHex("GameSettled(bytes32,address,bool,uint8,uint256,uint256,uint256,uint256,bytes32,bytes32,uint256)"),
);

function nowMs() {
  return Date.now();
}

function ttlMs(tf: Timeframe) {
  if (tf === "daily") return 25_000;
  if (tf === "weekly") return 35_000;
  if (tf === "monthly") return 45_000;
  return 60_000;
}

function getKey(address: string, chain: ChainKey, tf: Timeframe, limit: number) {
  return `pg:${chain}:${tf}:${address.toLowerCase()}:${limit}`;
}

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as any;
  if (!g.__PROFILE_GAMES_CACHE__) g.__PROFILE_GAMES_CACHE__ = new Map<string, CacheEntry>();
  return g.__PROFILE_GAMES_CACHE__;
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

function parseAddress(v: string | null): `0x${string}` | null {
  if (!v) return null;
  const s = v.trim();
  if (!s.startsWith("0x") || s.length !== 42) return null;
  return s as `0x${string}`;
}

function parseChain(v: string | null): ChainKey {
  if (v === "base" || v === "linea") return v;
  return "base";
}

function parseTf(v: string | null): Timeframe {
  if (v === "daily" || v === "weekly" || v === "monthly" || v === "all") return v;
  return "weekly";
}

function parseLimit(v: string | null) {
  const n = Number(v ?? "25");
  if (!Number.isFinite(n)) return 25;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

function toDtc6(n: bigint) {
  const sign = n < 0n ? -1n : 1n;
  const v = n < 0n ? -n : n;
  const base = 10n ** DTC_DECIMALS;
  const whole = v / base;
  const frac = (v % base) / 10n ** (DTC_DECIMALS - 6n);
  const num = Number(whole) + Number(frac) / 1_000_000;
  return sign < 0n ? -num : num;
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

function topicAddress(addr: `0x${string}`) {
  const a = addr.toLowerCase().replace(/^0x/, "");
  return (`0x${"0".repeat(24)}${a}`) as `0x${string}`;
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
  const delta = (day + 6) % 7; // monday=0
  const start = Date.UTC(y, m, d - delta, 0, 0, 0) / 1000;
  const end = Date.UTC(y, m, d - delta + 7, 0, 0, 0) / 1000;
  return { startSec: start, endSec: end };
}

async function rpcCall(rpc: string, method: string, params: any[]) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
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

async function rpcBlockTimestamp(rpcs: string[], block: bigint) {
  const hexBlock = "0x" + block.toString(16);
  const b = await rpcTry(rpcs, (rpc) => rpcCall(rpc, "eth_getBlockByNumber", [hexBlock, false]));
  const tsHex = (b as any)?.timestamp;
  if (typeof tsHex !== "string" || !tsHex.startsWith("0x")) throw new Error("bad block timestamp");
  return Number(BigInt(tsHex));
}

async function rpcFindBlockByTime(rpcs: string[], tsSec: number, closest: "before" | "after") {
  const latest = await rpcLatestBlockNumber(rpcs);
  let lo = 0n;
  let hi = latest;
  let best: bigint | null = null;

  for (let i = 0; i < 40 && lo <= hi; i++) {
    const mid = (lo + hi) / 2n;
    const midTs = await rpcBlockTimestamp(rpcs, mid);

    if (midTs === tsSec) {
      best = mid;
      break;
    }

    if (midTs < tsSec) {
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

function isTooManyResultsError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("query returned more than") ||
    m.includes("response size exceeded") ||
    m.includes("exceeds limit") ||
    m.includes("too large") ||
    m.includes("log response size exceeded")
  );
}

async function rpcGetLogsRange(rpcs: string[], filter: any) {
  const res = await rpcTry(rpcs, (rpc) => rpcCall(rpc, "eth_getLogs", [filter]));
  if (!Array.isArray(res)) return [];
  return res;
}

async function rpcGetLogsSplit(
  rpcs: string[],
  baseFilter: { address: string; topics: any[]; fromBlock: string; toBlock: string },
  depth = 0,
): Promise<any[]> {
  try {
    return await rpcGetLogsRange(rpcs, baseFilter);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (!isTooManyResultsError(msg) || depth >= 16) throw e;

    const from = BigInt(baseFilter.fromBlock);
    const to = BigInt(baseFilter.toBlock === "latest" ? "0x0" : baseFilter.toBlock);
    if (to <= from) return [];

    const mid = (from + to) / 2n;
    const left = { ...baseFilter, toBlock: "0x" + mid.toString(16) };
    const right = { ...baseFilter, fromBlock: "0x" + (mid + 1n).toString(16) };

    const a = await rpcGetLogsSplit(rpcs, left, depth + 1);
    await sleep(jitter(40));
    const b = await rpcGetLogsSplit(rpcs, right, depth + 1);
    return a.concat(b);
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

  if (!s || !/^\d+$/.test(s)) throw new Error(`getblocknobytime bad result: ${JSON.stringify(j)}`);
  const bn = BigInt(s);
  return bn < 0n ? 0n : bn;
}

async function blockscoutGetLogsOnce(args: {
  apiBase: string;
  address: `0x${string}`;
  fromBlock: bigint;
  toBlock: bigint;
  topic0: `0x${string}`;
  topic2?: `0x${string}`; // player
  page?: number;
  offset?: number;
}) {
  const u = new URL(args.apiBase);
  u.searchParams.set("module", "logs");
  u.searchParams.set("action", "getLogs");
  u.searchParams.set("fromBlock", args.fromBlock.toString());
  u.searchParams.set("toBlock", args.toBlock.toString());
  u.searchParams.set("address", args.address);
  u.searchParams.set("topic0", args.topic0);
  if (args.topic2) u.searchParams.set("topic2", args.topic2);
  u.searchParams.set("page", String(args.page ?? 1));
  u.searchParams.set("offset", String(args.offset ?? 1000));

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

async function collectLogsFast(args: {
  chain: ChainKey;
  address: `0x${string}`;
  tf: Timeframe;
  limit: number;
}) {
  const cfg = CHAIN[args.chain];
  const addrTopic = topicAddress(args.address);

  const { startSec, endSec } = utcRange(args.tf, new Date());
  const start = Math.max(0, Math.floor(startSec));
  const end = Math.max(start + 1, Math.floor(endSec));

  const hasBlockscout = args.chain === "base" && !!cfg.blockscoutApi;
  const method: "blockscout" | "rpc" = hasBlockscout ? "blockscout" : "rpc";

  const latest = await rpcLatestBlockNumber(cfg.rpcs);

  // Determine initial window
  let fromBlock = 0n;
  let toBlock = latest;

  if (args.tf !== "all") {
    if (method === "blockscout" && cfg.blockscoutApi) {
      fromBlock = await blockscoutGetBlockByTime(cfg.blockscoutApi, start, "after");
      toBlock = await blockscoutGetBlockByTime(cfg.blockscoutApi, end, "before");
    } else {
      fromBlock = await rpcFindBlockByTime(cfg.rpcs, start, "after");
      toBlock = await rpcFindBlockByTime(cfg.rpcs, end, "before");
    }
    if (toBlock < fromBlock) {
      const t = fromBlock;
      fromBlock = toBlock;
      toBlock = t;
    }
  }

  // For "all", do a backward expanding window until we collect enough.
  // Start with a moderate range and expand.
  let window = 200_000n;
  if (args.tf === "all") {
    toBlock = latest;
    fromBlock = latest > window ? latest - window : 0n;
  }

  const collected: any[] = [];
  const maxExpands = args.tf === "all" ? 8 : 1;

  for (let attempt = 0; attempt < maxExpands; attempt++) {
    if (method === "blockscout" && cfg.blockscoutApi) {
      // Page through until we have enough (or no more pages)
      let page = 1;
      const offset = 1000;

      while (true) {
        const chunk = await blockscoutGetLogsOnce({
          apiBase: cfg.blockscoutApi,
          address: cfg.game,
          fromBlock,
          toBlock,
          topic0: TOPIC_GAME_SETTLED as `0x${string}`,
          topic2: addrTopic,
          page,
          offset,
        });

        if (!chunk.length) break;
        collected.push(...chunk);

        if (collected.length >= args.limit * 3) break; // enough headroom before decode+filter+sort
        if (chunk.length < offset) break;
        page += 1;
        await sleep(jitter(60));
      }
    } else {
      const fromHex = "0x" + fromBlock.toString(16);
      const toHex = "0x" + toBlock.toString(16);

      const chunk = await rpcGetLogsSplit(
        cfg.rpcs,
        {
          address: cfg.game,
          topics: [TOPIC_GAME_SETTLED, null, addrTopic],
          fromBlock: fromHex,
          toBlock: toHex,
        } as any,
      );

      collected.push(...chunk);
    }

    if (args.tf !== "all") break;

    if (collected.length >= args.limit * 3) break;

    // expand backwards
    window = window * 2n;
    toBlock = fromBlock > 0n ? fromBlock : 0n;
    if (toBlock === 0n) break;
    fromBlock = toBlock > window ? toBlock - window : 0n;

    await sleep(jitter(80));
  }

  return { method, fromBlock, toBlock, logs: collected, utc: { startSec: start, endSec: end }, latestBlock: latest };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const address = parseAddress(url.searchParams.get("address"));
    if (!address) return NextResponse.json({ ok: false, error: "Missing/invalid address" }, { status: 400 });

    const chainKey = parseChain(url.searchParams.get("chain"));
    const tf = parseTf(url.searchParams.get("tf"));
    const limit = parseLimit(url.searchParams.get("limit"));

    const cacheKey = getKey(address, chainKey, tf, limit);
    const cached = readCache(cacheKey);
    if (cached) return NextResponse.json(cached, { headers: { "Cache-Control": "no-store" } });

    const { method, fromBlock, toBlock, logs, utc, latestBlock } = await collectLogsFast({
      chain: chainKey,
      address,
      tf,
      limit,
    });

    const rows: GameRow[] = [];

    for (const l of logs) {
      const topics = normalizeTopics((l as any).topics ?? l);
      const data = String((l as any).data ?? "0x") as `0x${string}`;
      const txHashRaw = String((l as any).transactionHash || (l as any).transaction_hash || "");
      const txHash =
        txHashRaw && txHashRaw.startsWith("0x") && txHashRaw.length === 66
          ? (txHashRaw as `0x${string}`)
          : (("0x" + "0".repeat(64)) as `0x${string}`);

      let decoded: any;
      try {
        decoded = decodeEventLog({ abi: GAME_ABI, data, topics: topics as any });
      } catch {
        continue;
      }
      if (decoded?.eventName !== "GameSettled") continue;

      const player = String((decoded.args as any).player || "").toLowerCase();
      if (player !== address.toLowerCase()) continue;

      const gameId = String((decoded.args as any).gameId || "") as `0x${string}`;
      const won = Boolean((decoded.args as any).won);
      const cashoutHop = Number((decoded.args as any).cashoutHop ?? 0);

      const amountReceived = asBigInt((decoded.args as any).amountReceived);
      const payout = asBigInt((decoded.args as any).payout);
      const playerNetWin = asBigInt((decoded.args as any).playerNetWin);

      const settledAtSec = Number(asBigInt((decoded.args as any).settledAt));
      const tsMs = Number.isFinite(settledAtSec) && settledAtSec > 0 ? settledAtSec * 1000 : 0;

      rows.push({
        chain: chainKey,
        gameId,
        won,
        cashoutHop,
        wagerDtc: toDtc6(amountReceived),
        payoutDtc: toDtc6(payout),
        pnlDtc: toDtc6(playerNetWin),
        txHash,
        timestamp: tsMs,
      });
    }

    rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const sliced = rows.slice(0, limit);

    const payload: ApiPayload = {
      ok: true,
      address,
      chain: chainKey,
      tf,
      rows: sliced,
      meta: {
        source: "blockscout+rpc",
        method,
        asOfMs: nowMs(),
        utc,
        range: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), latestBlock: latestBlock.toString() },
        matched: rows.length,
        returned: sliced.length,
        scannedLogs: logs.length,
      },
    };

    writeCache(cacheKey, payload, ttlMs(tf));
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}