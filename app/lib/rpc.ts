import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { base, linea } from "viem/chains";

export const RPC_URLS_BY_CHAIN: Record<number, string[]> = {
  59144: [
    "https://rpc.linea.build",
    "https://linea.drpc.org",
  ],
  8453: [
    "https://rpc.ankr.com/base",
    "https://base.drpc.org",
  ],
};

export function makePublicClient(chainId: number): PublicClient {
  if (chainId === 59144) {
    return createPublicClient({
      chain: linea,
      transport: fallback(RPC_URLS_BY_CHAIN[59144].map((u) => http(u, { timeout: 15_000, retryCount: 0 }))),
    });
  }

  if (chainId === 8453) {
    return createPublicClient({
      chain: base,
      transport: fallback(RPC_URLS_BY_CHAIN[8453].map((u) => http(u, { timeout: 15_000, retryCount: 0 }))),
    });
  }

  throw new Error(`Unsupported chainId: ${chainId}`);
}
