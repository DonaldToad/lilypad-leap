export type ChainKey = "linea" | "base";

export type ChainConfig = {
  key: ChainKey;
  name: string;
  shortName: string;
  chainId: number;
  enabled: boolean;
  isPrimary: boolean;

  dtcSymbol: "DTC";
  dtcAddress?: `0x${string}`;
  explorerBaseUrl?: string;

  swapLabel: string;
  swapUrl?: string;

  statusTag: "LIVE" | "SOON";
  note: string;
};

export const CHAINS: Record<ChainKey, ChainConfig> = {
  linea: {
    key: "linea",
    name: "Linea",
    shortName: "Linea",
    chainId: 59144,
    enabled: true,
    isPrimary: true,

    dtcSymbol: "DTC",
    // dtcAddress: "0x...", // optional
    explorerBaseUrl: "https://lineascan.build",

    swapLabel: "Trade DTC on Linea (Lynex)",
    // swapUrl: "https://...", // optional later

    statusTag: "LIVE",
    note: "DTC has been tradable on Linea since 2024. Linea is the primary launch chain for Lilypad Leap.",
  },

  base: {
    key: "base",
    name: "Base",
    shortName: "Base",
    chainId: 8453,
    enabled: false,
    isPrimary: false,

    dtcSymbol: "DTC",
    // dtcAddress: "0x...", // optional
    explorerBaseUrl: "https://basescan.org",

    swapLabel: "Trade DTC on Base (Uniswap) — coming soon",
    // swapUrl: "https://app.uniswap.org/swap?chain=base&...", // later

    statusTag: "SOON",
    note: "Base launch will follow Lilypad Leap launch. After Uniswap listing, the game will expand to Base.",
  },
};

export const PRIMARY_CHAIN: ChainConfig = CHAINS.linea;

export const CHAIN_LIST: ChainConfig[] = [CHAINS.linea, CHAINS.base];
