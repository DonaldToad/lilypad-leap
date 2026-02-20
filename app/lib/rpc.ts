import { createPublicClient, fallback, http } from "viem";
import { base, linea } from "viem/chains";

export const RPC_URLS_BY_CHAIN: Record<number, string[]> = {
  8453: ["https://base-rpc.publicnode.com", "https://1rpc.io/base", "https://rpc.ankr.com/base"],
  59144: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://1rpc.io/linea"],
};

function normalizeRpcList(urls: string[]) {
  const cleaned = urls.map((u) => (u || "").trim()).filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const u of cleaned) {
    const k = u.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(u);
  }
  return uniq;
}

export function getPublicClient(chainId: number) {
  const urls = normalizeRpcList(RPC_URLS_BY_CHAIN[chainId] || []);
  if (!urls.length) return null;

  const chainObj = chainId === 8453 ? base : chainId === 59144 ? linea : null;
  if (!chainObj) return null;

  const transports = urls.map((u) => http(u, { timeout: 15_000, retryCount: 0 }));
  const transport = transports.length === 1 ? transports[0] : fallback(transports, { rank: false });

  return createPublicClient({
    chain: chainObj,
    transport,
    batch: { multicall: true },
  }) as any;
}