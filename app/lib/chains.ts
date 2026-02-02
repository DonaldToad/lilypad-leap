// app/lib/chains.ts
export const BASE_ENABLED = process.env.NEXT_PUBLIC_BASE_ENABLED === "true";

export type ChainDef = {
  key: "linea" | "base";
  name: string;
  chainId: number;
  explorerBaseUrl: string;
  statusTag: "LIVE" | "SOON";
  note: string;
  isPrimary?: boolean;
  enabled: boolean;
};

export const PRIMARY_CHAIN: ChainDef = {
  key: "linea",
  name: "Linea",
  chainId: 59144,
  explorerBaseUrl: "https://lineascan.build",
  statusTag: "LIVE",
  note: "Live now. Demo today, token play later.",
  isPrimary: true,
  enabled: true,
};

export const BASE_CHAIN: ChainDef = {
  key: "base",
  name: "Base",
  chainId: 8453,
  explorerBaseUrl: "https://basescan.org",
  statusTag: BASE_ENABLED ? "LIVE" : "SOON",
  note: BASE_ENABLED
    ? "Enabled. Uses DTC OFT on Base."
    : "Disabled until Uniswap launch (toggle later).",
  enabled: BASE_ENABLED,
};

export const CHAIN_LIST: ChainDef[] = [PRIMARY_CHAIN, BASE_CHAIN];
