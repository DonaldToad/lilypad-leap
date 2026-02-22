import { NextResponse } from "next/server";
import { createPublicClient, decodeEventLog, http, keccak256, toHex, type Abi } from "viem";

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
    blockscoutApi: string;
    rpc: string;
  }
> = {
  base: {
    chainId: 8453,
    game: "0x05df07E37B8dF836549B28AA3195FD54D57DD845",
    registry: "0x994a28Bb8d84AacB691bA8773e81dAFC1acEb39B",
    blockscoutApi: "https://base.blockscout.com/api",
    rpc: "https://base-rpc.publicnode.com",
  },
  linea: {
    chainId: 59144,
    game: "0x5Eb6920Af0163e749274619E8076666885Bf0B57",
    registry: "0xAbD4c0dF150025a1982FC8236e5880EcC9156BeE",
    blockscoutApi: "https://explorer.linea.build/api",
    rpc: "https://rpc.linea.build",
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

function looksHex(s: string) {
  return /^0x[0-9a-fA-F]+$/.test(s);
}

function looksInt(s: string) {
  return /^-?\d+$/.test(s);
}

function extractNumberish(x: any, depth = 0): string | null {
  if (x == null) return null;
  if (typeof x === "bigint") return x.toString();
  if (typeof x === "number") return String(x);
  if (typeof x === "string") return looksHex(x) || looksInt(x) ? x : null;
  if (typeof x !== "object") return null;
  if (depth > 4) return null;

  const h1 = (x as any).hex;
  if (typeof h1 === "string" && looksHex(h1)) return h1;

  const h2 = (x as any)._hex;
  if (typeof h2 === "string" && looksHex(h2)) return h2;

  const b1 = (x as any).bigint;
  const eb1 = extractNumberish(b1, depth + 1);
  if (eb1) return eb1;

  const v1 = (x as any).value;
  const ev1 = extractNumberish(v1, depth + 1);
  if (ev1) return ev1;

  const v2 = (x as any)._value;
  const ev2 = extractNumberish(v2, depth + 1);
  if (ev2) return ev2;

  const r1 = (x as any).result;
  const er1 = extractNumberish(r1, depth + 1);
  if (er1) return er1;

  for (const k of Object.keys(x)) {
    const ev = extractNumberish((x as any)[k], depth + 1);
    if (ev) return ev;
  }

  try {
    const s = (x as any).toString?.();
    if (typeof s === "string" && s && s !== "[object Object]" && (looksHex(s) || looksInt(s))) return s;
  } catch {}

  return null;
}

function asBigInt(x: any): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  if (typeof x === "string") return BigInt(x);
  const s = extractNumberish(x);
  if (!s) throw new Error(`Cannot convert [object Object] to a BigInt`);
  return BigInt(s);
}

function mustBigInt(label: string, x: any): bigint {
  try {
    return asBigInt(x);
  } catch (e: any) {
    let extra = "";
    try {
      extra = typeof x === "object" ? JSON.stringify(x) : String(x);
    } catch {}
    throw new Error(`${label}: ${e?.message ?? e} | value=${extra}`);
  }
}

async function getLogsPaged(
  client: Client,
  args: { address: `0x${string}`; fromBlock: bigint; toBlock: bigint; topics?: any },
) {
  let span = 20_000n;
  const out: any[] = [];
  let from = args.fromBlock;
  const to = args.toBlock;

  while (from <= to) {
    const end = from + span > to ? to : from + span;
    try {
      const logs = await client.getLogs({
        address: args.address,
        fromBlock: from,
        toBlock: end,
        topics: args.topics,
      } as any);
      out.push(...logs);
      from = end + 1n;
    } catch (e: any) {
      if (span <= 1000n) throw e;
      span = span / 2n;
      await sleep(jitter(140));
    }
  }

  return out;
}

const TOPIC_GAME_SETTLED = keccak256(
  toHex("GameSettled(bytes32,address,bool,uint8,uint256,uint256,uint256,uint256,bytes32,bytes32,uint256)"),
);
const TOPIC_BOUND = keccak256(toHex("Bound(address,address,bytes32)"));
const TOPIC_CLAIMED = keccak256(toHex("Claimed(uint256,address,uint256)"));

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
        const client = createPublicClient({ transport: http(cfg.rpc) });

        const startBlock = tf === "all" ? 0n : await blockscoutGetBlockByTime(cfg.blockscoutApi, start, "after");
        const endBlock = await blockscoutGetBlockByTime(cfg.blockscoutApi, end, "before");

        const fromBlock = startBlock;
        const toBlock = endBlock >= fromBlock ? endBlock : fromBlock;

        const gameLogs = await getLogsPaged(client, {
          address: cfg.game,
          fromBlock,
          toBlock,
          topics: [TOPIC_GAME_SETTLED],
        });

        const boundLogs = await getLogsPaged(client, {
          address: cfg.registry,
          fromBlock,
          toBlock,
          topics: [TOPIC_BOUND],
        });

        const claimedLogs = await getLogsPaged(client, {
          address: cfg.registry,
          fromBlock,
          toBlock,
          topics: [TOPIC_CLAIMED],
        });

        let gameCount = 0;
        let boundCount = 0;
        let claimedCount = 0;

        for (const log of gameLogs) {
          let decoded: any;
          try {
            decoded = decodeEventLog({
              abi: GAME_ABI,
              data: log.data as `0x${string}`,
              topics: log.topics as any,
            });
          } catch {
            continue;
          }
          if (decoded?.eventName !== "GameSettled") continue;

          const player = String((decoded.args as any).player || "").toLowerCase();
          if (!player || !player.startsWith("0x") || player.length !== 42) continue;

          const amountReceived = mustBigInt(`${chainKey}.GameSettled.amountReceived`, (decoded.args as any).amountReceived);
          const playerNetWin = mustBigInt(`${chainKey}.GameSettled.playerNetWin`, (decoded.args as any).playerNetWin);

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

        for (const log of boundLogs) {
          let decoded: any;
          try {
            decoded = decodeEventLog({
              abi: REG_ABI,
              data: log.data as `0x${string}`,
              topics: log.topics as any,
            });
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

        for (const log of claimedLogs) {
          let decoded: any;
          try {
            decoded = decodeEventLog({
              abi: REG_ABI,
              data: log.data as `0x${string}`,
              topics: log.topics as any,
            });
          } catch {
            continue;
          }
          if (decoded?.eventName !== "Claimed") continue;

          const referrer = String((decoded.args as any).referrer || "").toLowerCase();
          if (!referrer.startsWith("0x") || referrer.length !== 42) continue;

          const amount = mustBigInt(`${chainKey}.Claimed.amount`, (decoded.args as any).amount);

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
          rpc: cfg.rpc,
          blockscout: cfg.blockscoutApi,
          startBlock: fromBlock.toString(),
          endBlock: toBlock.toString(),
          logs: { game: gameCount, bound: boundCount, claimed: claimedCount },
        };

        okChains += 1;
      } catch (e: any) {
        perChainErrors[chainKey] = String(e?.message ?? e);
        perChainMeta[chainKey] = { rpc: cfg.rpc, blockscout: cfg.blockscoutApi };
      }
    }

    if (okChains === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "All chains failed",
          tf,
          meta: { source: "blockscout+rpc-logs", asOfMs: nowMs(), utc: { startSec: start, endSec: end }, perChain: perChainMeta, errors: perChainErrors },
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