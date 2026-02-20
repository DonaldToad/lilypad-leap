export const runtime = "edge";
import { NextResponse } from "next/server";

type CacheEntry = { exp: number; payload: any };

function nowMs() {
  return Date.now();
}

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as any;
  if (!g.__DTC_PRICE_CACHE__) g.__DTC_PRICE_CACHE__ = new Map<string, CacheEntry>();
  return g.__DTC_PRICE_CACHE__;
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

function writeCache(key: string, payload: any, ttlMs: number) {
  getCache().set(key, { exp: nowMs() + ttlMs, payload });
}

export async function GET() {
  try {
    const key = "dtc:usd";
    const cached = readCache(key);
    if (cached) {
      return NextResponse.json(cached, { headers: { "Cache-Control": "no-store" } });
    }

    const coinId = (process.env.DTC_COINGECKO_ID || "").trim();
    if (!coinId) {
      const payload = { ok: false, usd: null, source: "coingecko", error: "Missing DTC_COINGECKO_ID" };
      writeCache(key, payload, 60_000);
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    }

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      coinId,
    )}&vs_currencies=usd`;

    const r = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!r.ok) {
      const payload = { ok: false, usd: null, source: "coingecko", error: `HTTP ${r.status}` };
      writeCache(key, payload, 45_000);
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    }

    const j = (await r.json()) as any;
    const usd = Number(j?.[coinId]?.usd);

    const payload = {
      ok: Number.isFinite(usd) ? true : false,
      usd: Number.isFinite(usd) ? usd : null,
      source: "coingecko",
      asOfMs: nowMs(),
    };

    writeCache(key, payload, 60_000);

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, usd: null, source: "coingecko", error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}