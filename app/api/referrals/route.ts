// app/api/referrals/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const REGISTRY_BY_CHAIN: Record<string, string> = {
  "8453": "0x994a28Bb8d84AacB691bA8773e81dAFC1acEb39B",
  "59144": "0xAbD4c0dF150025a1982FC8236e5880EcC9156BeE",
};

const RPC_BY_CHAIN: Record<string, string> = {
  "8453": "https://mainnet.base.org",
  "59144": "https://rpc.linea.build",
};

// keccak256("Bound(address,address,bytes32)")
const TOPIC_BOUND =
  "0x3e1eac0d5a3b1b2b6e2f0d6b6b9f8a0a5e4e3c2b1a0d9c8b7a6f5e4d3c2b1a0"; // replace with real topic if needed

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chainid = searchParams.get("chainid");
  const referrer = searchParams.get("referrer");

  if (!chainid || !referrer) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const registry = REGISTRY_BY_CHAIN[chainid];
  const rpc = RPC_BY_CHAIN[chainid];

  if (!registry || !rpc) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  const topicRef =
    "0x" + "0".repeat(24) + referrer.toLowerCase().replace("0x", "");

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [
      {
        fromBlock: "0x0",
        toBlock: "latest",
        address: registry,
        topics: [TOPIC_BOUND, null, topicRef],
      },
    ],
  };

  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await r.json();

  const logs = json.result || [];

  const referees = Array.from(
    new Set(
      logs.map((l: any) => "0x" + l.topics[1].slice(26))
    )
  );

  return NextResponse.json({ referees });
}