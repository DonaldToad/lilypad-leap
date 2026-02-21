import { DTC_BY_CHAIN, LILYPAD_VAULT_BY_CHAIN } from "./addresses";

export type RefStat = { games: number; wagered: string; won: string };
export type RefStats = Record<string, RefStat>;

const API = (process.env.NEXT_PUBLIC_ETHERSCAN_V2_URL || "").trim();
const KEY = (process.env.NEXT_PUBLIC_ETHERSCAN_V2_API_KEY || "").trim();

function isHexAddress(x: string) {
  return /^0x[a-fA-F0-9]{40}$/.test((x || "").trim());
}

export async function fetchRefStatsFromEtherscan(args: {
  chainId: number;
  refs: string[];
  signal?: AbortSignal;
}): Promise<RefStats> {
  const { chainId, refs, signal } = args;

  if (!API || !KEY) return {};

  const token = DTC_BY_CHAIN[chainId];
  const vault = LILYPAD_VAULT_BY_CHAIN[chainId];
  if (!token || !vault) return {};

  const wanted = new Set(refs.map((r) => (r || "").toLowerCase()).filter((r) => isHexAddress(r)));

  const stats: Record<string, { games: number; wagered: bigint; won: bigint }> = {};
  for (const r of wanted) stats[r] = { games: 0, wagered: 0n, won: 0n };

  const vaultL = vault.toLowerCase();

  const url =
    `${API}?chainid=${chainId}` +
    `&module=account&action=tokentx` +
    `&contractaddress=${token}` +
    `&address=${vault}` +
    `&startblock=0&endblock=latest` +
    `&sort=asc` +
    `&apikey=${KEY}`;

  const res = await fetch(url, { signal, cache: "no-store" });
  const data = await res.json().catch(() => null);

  if (!data || data.status !== "1" || !Array.isArray(data.result)) return {};

  for (const tx of data.result) {
    const from = String(tx?.from || "").toLowerCase();
    const to = String(tx?.to || "").toLowerCase();
    if (!from || !to) continue;

    let value = 0n;
    try {
      value = BigInt(String(tx?.value ?? "0"));
    } catch {
      value = 0n;
    }
    if (value <= 0n) continue;

    if (wanted.has(from) && to === vaultL) {
      stats[from].wagered += value;
      stats[from].games += 1;
    }

    if (wanted.has(to) && from === vaultL) {
      stats[to].won += value;
    }
  }

  const out: RefStats = {};
  for (const [k, v] of Object.entries(stats)) {
    out[k] = { games: v.games, wagered: v.wagered.toString(), won: v.won.toString() };
  }
  return out;
}