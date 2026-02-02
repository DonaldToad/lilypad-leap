export type RouteKey = "SAFE" | "WILD" | "INSANE";

export type HopRow = {
  hop: number; // 1..10
  successPct: number; // e.g. 83.5
  cashoutX: number; // cashout multiplier if you stop AFTER this hop
};

export type RouteTable = {
  key: RouteKey;
  label: string;
  tagline: string;
  rows: HopRow[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Demo tables (UI only).
 * We keep these deterministic and legible.
 * Later, we will replace/derive these from the on-chain multiplier math.
 */
export const ROUTE_TABLES: Record<RouteKey, RouteTable> = {
  SAFE: {
    key: "SAFE",
    label: "Safe Swamp",
    tagline: "Lower risk curve. Smooth multipliers.",
    rows: Array.from({ length: 10 }).map((_, i) => {
      const hop = i + 1;
      const successPct = round2(92 - hop * 1.2); // 90.8 .. 80.0-ish
      const cashoutX = round2(1 + hop * 0.18); // 1.18 .. 2.8
      return { hop, successPct, cashoutX };
    }),
  },
  WILD: {
    key: "WILD",
    label: "Wild Swamp",
    tagline: "Balanced. Noticeable risk ramp.",
    rows: Array.from({ length: 10 }).map((_, i) => {
      const hop = i + 1;
      const successPct = round2(88 - hop * 2.0); // 86 .. 68
      const cashoutX = round2(1 + hop * 0.28); // 1.28 .. 3.8
      return { hop, successPct, cashoutX };
    }),
  },
  INSANE: {
    key: "INSANE",
    label: "Insane Swamp",
    tagline: "High risk. Multipliers accelerate fast.",
    rows: Array.from({ length: 10 }).map((_, i) => {
      const hop = i + 1;
      const successPct = round2(84 - hop * 2.8); // 81.2 .. 56
      const cashoutX = round2(1 + hop * 0.42); // 1.42 .. 5.2
      return { hop, successPct, cashoutX };
    }),
  },
};
