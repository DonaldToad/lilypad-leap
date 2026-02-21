import { NextResponse } from "next/server";

export const runtime = "edge";

const BASE_UPSTREAMS = [
  "https://mainnet.base.org",
  "https://1rpc.io/base",
  "https://base-rpc.publicnode.com",
];

const LINEA_UPSTREAMS = [
  "https://rpc.linea.build",
  "https://1rpc.io/linea",
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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request, ctx: { params: Promise<{ chainId: string }> }) {
  const { chainId: chainIdStr } = await ctx.params;
  const chainId = Number(chainIdStr);
  const upstreams = upstreamsFor(chainId);

  if (!upstreams.length) {
    return NextResponse.json({ ok: false, error: "Unsupported chainId" }, { status: 400 });
  }

  const body = await req.text();

  let lastErr = "";
  for (const upstream of upstreams) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(
          upstream,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          },
          10_000
        );

        if (res.status === 401 || res.status === 403) {
          lastErr = `upstream ${upstream} unauthorized (${res.status})`;
          break;
        }

        if (res.status === 429) {
          lastErr = `upstream ${upstream} rate-limited (429)`;
          await sleep(150 + attempt * 250);
          continue;
        }

        if (res.status >= 500) {
          lastErr = `upstream ${upstream} error (${res.status})`;
          await sleep(100 + attempt * 200);
          continue;
        }

        const text = await res.text();
        return new NextResponse(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      } catch (e: any) {
        lastErr = `upstream ${upstream} failed: ${String(e?.message || e)}`;
        await sleep(100 + attempt * 200);
      }
    }
  }

  return NextResponse.json({ ok: false, error: lastErr || "All upstreams failed" }, { status: 502 });
}