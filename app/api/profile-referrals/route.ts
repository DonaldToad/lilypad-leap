import { NextResponse } from "next/server";
import { decodeEventLog, keccak256, toHex, type Abi } from "viem";

export const runtime = "edge";

type Timeframe = "daily" | "weekly" | "monthly" | "all";
type ChainKey = "base" | "linea";

type ChainReferralSummary = {
  chain: ChainKey;
  referees: number;
  refereeGames: number;
  refereeVolumeDtc: number;
  refereeProfitDtc: number;
  claimedDtc: number;
};

type ApiPayload = {
  ok: boolean;
  tf: Timeframe;
  address: `0x${string}`;
  byChain: Partial<Record<ChainKey, ChainReferralSummary>>;
  total: Omit<ChainReferralSummary, "chain">;
  meta?: any;
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

function getKey(tf: Timeframe, address: string) {
  return `pr:${tf}:${address.toLowerCase()}`;
}

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as any;
  if (!g.__PROFILE_REF_CACHE__) g.__PROFILE_REF_CACHE__ = new Map<string, CacheEntry>();
  return g.__PROFILE_REF_CACHE__;
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

function parseAddress(v: string | null): `0x${string}` | null {
  if (!v) return null;
  const s = v.trim();
  if (!s.startsWith("0x") || s.length !== 42) return null;
  return s as `0x${string}`;
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
  topic1?: `0x${string}`;
  topic2?: `0x${string}`;
}) {
  const u = new URL(args.apiBase);
  u.searchParams.set("module", "logs");
  u.searchParams.set("action", "getLogs");
  u.searchParams.set("fromBlock", args.fromBlock.toString());
  u.searchParams.set("toBlock", args.toBlock.toString());
  u.searchParams.set("address", args.address);
  u.searchParams.set("topic0", args.topic0);
  if (args.topic1) u.searchParams.set("topic1", args.topic1);
  if (args.topic2) u.searchParams.set("topic2", args.topic2);
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
    const to = BigInt(baseFilter.toBlock);
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

function topicAddress(addr: `0x${string}`) {
  const a = addr.toLowerCase().replace(/^0x/, "");
  return (`0x${"0".repeat(24)}${a}`) as `0x${string}`;
}

function emptySummary(chain: ChainKey): ChainReferralSummary {
  return { chain, referees: 0, refereeGames: 0, refereeVolumeDtc: 0, refereeProfitDtc: 0, claimedDtc: 0 };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tf = parseTf(url.searchParams.get("tf"));
    const address = parseAddress(url.searchParams.get("address"));
    if (!address) return NextResponse.json({ ok: false, error: "Missing/invalid address" }, { status: 400 });

    const cacheKey = getKey(tf, address);
    const cached = readCache(cacheKey);
    if (cached) return NextResponse.json(cached, { headers: { "Cache-Control": "no-store" } });

    const { startSec, endSec } = utcRange(tf, new Date());
    const start = Math.max(0, Math.floor(startSec));
    const end = Math.max(start + 1, Math.floor(endSec));

    const byChain: Partial<Record<ChainKey, ChainReferralSummary>> = {};
    const metaPerChain: any = {};
    const errorsPerChain: any = {};
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
          fromBlock = tf === "all" ? 0n : await rpcFindBlockByTime(cfg.rpcs, start, "after");
          toBlock =
            tf === "all" ? await rpcLatestBlockNumber(cfg.rpcs) : await rpcFindBlockByTime(cfg.rpcs, end, "before");
        }

        if (toBlock < fromBlock) {
          const tmp = fromBlock;
          fromBlock = toBlock;
          toBlock = tmp;
        }

        const fromHex = "0x" + fromBlock.toString(16);
        const toHex = "0x" + toBlock.toString(16);
        const addrTopic = topicAddress(address);

        let boundLogs: any[] = [];
        let claimedLogs: any[] = [];
        let gameLogs: any[] = [];

        if (method === "blockscout" && cfg.blockscoutApi) {
          boundLogs = await blockscoutGetLogsOnce({
            apiBase: cfg.blockscoutApi,
            address: cfg.registry,
            fromBlock,
            toBlock,
            topic0: TOPIC_BOUND as `0x${string}`,
            topic2: addrTopic,
          });

          claimedLogs = await blockscoutGetLogsOnce({
            apiBase: cfg.blockscoutApi,
            address: cfg.registry,
            fromBlock,
            toBlock,
            topic0: TOPIC_CLAIMED as `0x${string}`,
            topic2: addrTopic,
          });

          gameLogs = await blockscoutGetLogsOnce({
            apiBase: cfg.blockscoutApi,
            address: cfg.game,
            fromBlock,
            toBlock,
            topic0: TOPIC_GAME_SETTLED as `0x${string}`,
          });
        } else {
          boundLogs = await rpcGetLogsSplit(cfg.rpcs, {
            address: cfg.registry,
            topics: [TOPIC_BOUND, null, addrTopic],
            fromBlock: fromHex,
            toBlock: toHex,
          } as any);

          await sleep(jitter(40));

          claimedLogs = await rpcGetLogsSplit(cfg.rpcs, {
            address: cfg.registry,
            topics: [TOPIC_CLAIMED, null, addrTopic],
            fromBlock: fromHex,
            toBlock: toHex,
          } as any);

          await sleep(jitter(40));

          gameLogs = await rpcGetLogsSplit(cfg.rpcs, {
            address: cfg.game,
            topics: [TOPIC_GAME_SETTLED],
            fromBlock: fromHex,
            toBlock: toHex,
          } as any);
        }

        const referees = new Set<string>();
        let boundCount = 0;

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

          const referrer = String((decoded.args as any).referrer || "").toLowerCase();
          const player = String((decoded.args as any).player || "").toLowerCase();
          if (referrer !== address.toLowerCase()) continue;
          if (!player.startsWith("0x") || player.length !== 42) continue;

          referees.add(player);
          boundCount += 1;
        }

        const summary = emptySummary(chainKey);
        summary.referees = referees.size;

        let gameCount = 0;
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
          if (!referees.has(player)) continue;

          const amountReceived = asBigInt((decoded.args as any).amountReceived);
          const playerNetWin = asBigInt((decoded.args as any).playerNetWin);

          summary.refereeGames += 1;
          summary.refereeVolumeDtc += toDtc2(amountReceived);
          summary.refereeProfitDtc += toDtc2(playerNetWin);

          gameCount += 1;
        }

        let claimedCount = 0;
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
          if (referrer !== address.toLowerCase()) continue;

          const amount = asBigInt((decoded.args as any).amount);
          summary.claimedDtc += toDtc2(amount);

          claimedCount += 1;
        }

        byChain[chainKey] = summary;

        metaPerChain[chainKey] = {
          method,
          startBlock: fromBlock.toString(),
          endBlock: toBlock.toString(),
          logs: { bound: boundCount, game: gameCount, claimed: claimedCount },
          referees: referees.size,
        };

        okChains += 1;
      } catch (e: any) {
        errorsPerChain[chainKey] = String(e?.message ?? e);
      }
    }

    if (okChains === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "All chains failed",
          tf,
          address,
          meta: { asOfMs: nowMs(), utc: { startSec: start, endSec: end }, errors: errorsPerChain },
        },
        { status: 500 },
      );
    }

    const total = { referees: 0, refereeGames: 0, refereeVolumeDtc: 0, refereeProfitDtc: 0, claimedDtc: 0 };
    for (const ck of Object.keys(byChain) as ChainKey[]) {
      const s = byChain[ck];
      if (!s) continue;
      total.referees += s.referees;
      total.refereeGames += s.refereeGames;
      total.refereeVolumeDtc += s.refereeVolumeDtc;
      total.refereeProfitDtc += s.refereeProfitDtc;
      total.claimedDtc += s.claimedDtc;
    }

    const payload: ApiPayload = {
      ok: true,
      tf,
      address,
      byChain,
      total,
      meta: {
        source: "blockscout+rpc",
        cached: false,
        asOfMs: nowMs(),
        utc: { startSec: start, endSec: end },
        perChain: metaPerChain,
        errors: Object.keys(errorsPerChain).length ? errorsPerChain : undefined,
        limitations: {
          claimableEpochCredit: "Not available from logs only; requires registry getters or credit events.",
        },
      },
    };

    writeCache(cacheKey, payload, ttlMs(tf));
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}