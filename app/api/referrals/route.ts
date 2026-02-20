// app/api/referrals/route.ts
import { NextRequest, NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_ETHERSCAN_V2_URL!;
const KEY = process.env.NEXT_PUBLIC_ETHERSCAN_V2_API_KEY!;

const REGISTRY_BY_CHAIN: Record<string, string> = {
  "8453": "0x994a28Bb8d84AacB691bA8773e81dAFC1acEb39B",
  "59144": "0xAbD4c0dF150025a1982FC8236e5880EcC9156BeE",
};

const TOPIC_BOUND =
  "0x" +
  Buffer.from("Bound(address,address,bytes32)")
    .toString("hex")
    .padEnd(64, "0");

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chainid = searchParams.get("chainid");
  const referrer = searchParams.get("referrer");

  if (!chainid || !referrer) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const registry = REGISTRY_BY_CHAIN[chainid];
  if (!registry) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  const topicRef =
    "0x" + "0".repeat(24) + referrer.toLowerCase().replace("0x", "");

  const url =
    `${API}?chainid=${chainid}` +
    `&module=logs&action=getLogs` +
    `&fromBlock=0&toBlock=latest` +
    `&address=${registry}` +
    `&topic0=${TOPIC_BOUND}` +
    `&topic2=${topicRef}` +
    `&apikey=${KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "1") {
    return NextResponse.json({ referees: [] });
  }

  const referees = Array.from(
    new Set(
      data.result.map((l: any) =>
        "0x" + l.topics[1].slice(26)
      )
    )
  );

  return NextResponse.json({ referees });
}
