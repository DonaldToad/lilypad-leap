// app/lib/chains.ts
export type ChainKey = "linea" | "base";

export type AppChain = {
  key: ChainKey;
  name: string;
  chainId: number;
  enabled?: boolean;
  statusTag: "LIVE" | "SOON";
  isPrimary?: boolean;
  note: string;

  // ✅ used by app/page.tsx
  explorerBaseUrl?: string; // e.g. https://basescan.org
};

export const CHAIN_LIST: AppChain[] = [
  {
    key: "linea",
    name: "Linea",
    chainId: 59144,
    enabled: true,
    statusTag: "LIVE",
    isPrimary: true,
    note: "Linea mainnet (primary chain).",
    explorerBaseUrl: "https://lineascan.build",
  },
  {
    key: "base",
    name: "Base",
    chainId: 8453,
    enabled: true,
    statusTag: "LIVE",
    note: "Base mainnet.",
    explorerBaseUrl: "https://basescan.org",
  },
];

export const PRIMARY_CHAIN = CHAIN_LIST.find((c) => c.isPrimary) ?? CHAIN_LIST[0];
