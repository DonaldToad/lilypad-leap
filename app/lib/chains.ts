// app/lib/chains.ts

export type ChainKey = "linea" | "base";

export type ChainDef = {
  key: ChainKey;
  name: string;
  chainId: number;
  statusTag: "LIVE" | "SOON";
  note: string;
  explorerBaseUrl?: string;

  // Used by some pages (like /swap) to show a slightly different description.
  swapLabel?: string;

  // Some pages reference swapUrl optionally
  swapUrl?: string;

  // UI flags
  isPrimary?: boolean;
  enabled?: boolean;
};

// Toggle Base availability from env (Cloudflare Pages: set NEXT_PUBLIC_BASE_ENABLED)
export const BASE_ENABLED =
  (process.env.NEXT_PUBLIC_BASE_ENABLED ?? "").toLowerCase() === "true";

// Primary chain is Linea (always enabled)
export const PRIMARY_CHAIN: ChainDef = {
  key: "linea",
  name: "Linea",
  chainId: 59144,
  statusTag: "LIVE",
  note: "Play is live on Linea. Demo available. Token mode comes soon.",
  swapLabel: "Swap on Linea (live).",
  // swapUrl optional; set later if you have a canonical swap link
  explorerBaseUrl: "https://lineascan.build",
  isPrimary: true,
  enabled: true,
};

// Base chain (can be toggled)
export const BASE_CHAIN: ChainDef = {
  key: "base",
  name: "Base",
  chainId: 8453,
  statusTag: BASE_ENABLED ? "LIVE" : "SOON",
  note: BASE_ENABLED
    ? "Base is enabled. DTC OFT support ready."
    : "Base can be temporarily disabled before launch.",
  swapLabel: BASE_ENABLED
    ? "Swap on Base (enabled)."
    : "Base swap will unlock on launch.",
  // swapUrl optional; set later when you decide canonical venue
  explorerBaseUrl: "https://basescan.org",
  isPrimary: false,
  enabled: BASE_ENABLED,
};

export const CHAIN_LIST: ChainDef[] = [PRIMARY_CHAIN, BASE_CHAIN];
