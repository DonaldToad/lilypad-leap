// app/api/stats/route.ts
import { NextRequest, NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_ETHERSCAN_V2_URL!;
const KEY = process.env.NEXT_PUBLIC_ETHERSCAN_V2_API_KEY!;

const TOKEN_BY_CHAIN: Record<string, string> = {
  "8453": "0xFbA669C72b588439B29F050b93500D8b645F9354",
  "59144": "0xEb1fD1dBB8aDDA4fa2b5A5C4bcE34F6F20d125D2",
};

const VAULT_BY_CHAIN: Record<string, string> = {
  "8453": "0x2C853B5a06A1F6C3A0aF4c1627993150c6585eb3",
  "59144": "0xF4Bf262565e0Cc891857DF08Fe55de5316d0Db45",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chainid = searchParams.get("chainid");
  const referees = searchParams.get("refs");

  if (!chainid || !referees) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const token = TOKEN_BY_CHAIN[chainid];
  const vault = VAULT_BY_CHAIN[chainid];

  const refs = referees.split(",");

  const url =
    `${API}?chainid=${chainid}` +
    `&module=account&action=tokentx` +
    `&contractaddress=${token}` +
    `&address=${vault}` +
    `&startblock=0&endblock=latest` +
    `&sort=asc` +
    `&apikey=${KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "1") {
    return NextResponse.json({ stats: {} });
  }

  const stats: Record<string, any> = {};

  for (const r of refs) {
    stats[r.toLowerCase()] = {
      games: 0,
      wagered: 0n,
      won: 0n,
    };
  }

  for (const tx of data.result) {
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    const value = BigInt(tx.value);

    if (stats[from] && to === vault.toLowerCase()) {
      stats[from].wagered += value;
      stats[from].games += 1;
    }

    if (stats[to] && from === vault.toLowerCase()) {
      stats[to].won += value;
    }
  }

  return NextResponse.json({ stats });
}
