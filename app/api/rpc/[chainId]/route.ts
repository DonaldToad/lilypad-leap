import { NextResponse } from "next/server";

export const runtime = "edge";

const BASE_UPSTREAMS = [
  "https://mainnet.base.org",
  "https://rpc.ankr.com/base",
  "https://1rpc.io/base",
];

const LINEA_UPSTREAMS = [
  "https://rpc.linea.build",
  "https://linea-mainnet.public.blastapi.io",
];

function upstreamsFor(chainId: number): string[] {
  if (chainId === 8453) return BASE_UPSTREAMS;
  if (chainId === 59144) return LINEA_UPSTREAMS;
  return [];
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: Request, { params }: { params: { chainId: string } }) {
  const chainId = Number(params.chainId);
  const upstreams = upstreamsFor(chainId);

  if (!upstreams.length) {
    return NextResponse.json({ ok: false, error: "Unsupported chainId" }, { status: 400 });
  }

  const body = await req.text();

  let lastErr = "";
  for (const upstream of upstreams) {
    try {
      const res = await fetchWithTimeout(
        upstream,
        { method: "POST", headers: { "content-type": "application/json" }, body },
        10_000
      );

      if (res.status === 429 || res.status >= 500) {
        lastErr = `upstream ${upstream} returned ${res.status}`;
        continue;
      }

      const text = await res.text();
      return new NextResponse(text, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    } catch (e: any) {
      lastErr = `upstream ${upstream} failed: ${String(e?.message || e)}`;
    }
  }

  return NextResponse.json({ ok: false, error: lastErr || "All upstreams failed" }, { status: 502 });
}