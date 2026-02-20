import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UPSTREAMS: Record<number, string[]> = {
  8453: [
    process.env.RPC_UPSTREAM_BASE || "",
    "https://base-rpc.publicnode.com",
    "https://1rpc.io/base",
    "https://mainnet.base.org",
  ].filter(Boolean),
  59144: [
    process.env.RPC_UPSTREAM_LINEA || "",
    "https://rpc.linea.build",
    "https://linea-rpc.publicnode.com",
    "https://1rpc.io/linea",
  ].filter(Boolean),
};

function isRetryable(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request, ctx: { params: Promise<{ chainId: string }> }) {
  const { chainId } = await ctx.params;
  const cid = Number(chainId);
  const upstreams = UPSTREAMS[cid];

  if (!upstreams?.length) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }

  const body = await req.text();
  const headers: Record<string, string> = { "content-type": "application/json" };

  let lastErr: any = null;

  for (const url of upstreams) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers,
          body,
          cache: "no-store",
        });

        const text = await r.text();

        if (r.ok) {
          return new NextResponse(text, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          });
        }

        if (!isRetryable(r.status)) {
          return new NextResponse(text, {
            status: r.status,
            headers: { "content-type": "application/json" },
          });
        }

        lastErr = { status: r.status, body: text };
        await sleep(250 * (attempt + 1));
      } catch (e) {
        lastErr = e;
        await sleep(250 * (attempt + 1));
      }
    }
  }

  return NextResponse.json(
    { error: "All upstream RPCs failed", detail: String(lastErr?.message || lastErr) },
    { status: 502 }
  );
}
