// lib/approvalPolicy.ts
export type ApprovalMode = "unlimited" | "limited";

export type ApprovalPolicy =
  | { kind: "unlimited" }
  | { kind: "limited"; capDtc: number };

const KEY_MODE = "lilypad:approvalPolicy";
const KEY_CAP = "lilypad:approvalCap";

function k(base: string, chainId: number, wallet: string) {
  return `${base}:${chainId}:${wallet.toLowerCase()}`;
}

export function loadApprovalPrefs(chainId: number, wallet: string): {
  mode: ApprovalMode;
  capDtc: number | null;
} {
  if (typeof window === "undefined") return { mode: "unlimited", capDtc: null };

  const modeRaw = window.localStorage.getItem(k(KEY_MODE, chainId, wallet));
  const capRaw = window.localStorage.getItem(k(KEY_CAP, chainId, wallet));

  const mode: ApprovalMode = modeRaw === "limited" ? "limited" : "unlimited";

  let capDtc: number | null = null;
  if (capRaw && capRaw.trim().length) {
    const n = Number(capRaw);
    if (Number.isFinite(n) && n > 0) capDtc = Math.floor(n);
  }

  return { mode, capDtc };
}

export function saveApprovalPrefs(chainId: number, wallet: string, mode: ApprovalMode, capDtc: number | null) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(k(KEY_MODE, chainId, wallet), mode);
  if (mode === "limited" && capDtc && capDtc > 0) {
    window.localStorage.setItem(k(KEY_CAP, chainId, wallet), String(Math.floor(capDtc)));
  } else {
    window.localStorage.removeItem(k(KEY_CAP, chainId, wallet));
  }
}

export function toPolicy(mode: ApprovalMode, capDtc: number | null, fallbackCapDtc: number): ApprovalPolicy {
  if (mode === "unlimited") return { kind: "unlimited" };
  const cap = capDtc && capDtc > 0 ? capDtc : fallbackCapDtc;
  return { kind: "limited", capDtc: Math.max(1, Math.floor(cap)) };
}
