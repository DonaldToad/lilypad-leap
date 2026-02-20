// app/api/rpc/[chainId]/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";

const UPSTREAMS: Record<number, string[]> = {
  8453: [
    "https://mainnet.base.org",
    "https://1rpc.io/base",
  ],
  59144: [
    "https://rpc.linea.build",
    "https://1rpc.io/linea",
  ],
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ chainId: string }> }
) {
  const { chainId } = await ctx.params;
  const cid = Number(chainId);
  const upstreams = UPSTREAMS[cid];

  if (!upstreams?.length) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }

  const body = await req.text();

  for (const url of upstreams) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        cache: "no-store",
      });

      if (r.ok) {
        const text = await r.text();
        return new NextResponse(text, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    } catch {}
  }

  return NextResponse.json({ error: "RPC upstream failed" }, { status: 502 });
}