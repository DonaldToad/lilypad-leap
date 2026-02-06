
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { ApprovalPolicy, ApprovalMode } from "../lib/approvalPolicy";
import { loadApprovalPrefs, saveApprovalPrefs, toPolicy } from "../lib/approvalPolicy";

export default function ApprovalToggle(props: {
  chainId: number;
  wallet: `0x${string}`;
  amountDtc: number;
  maxAmountDtc: number;
  onPolicyChange: (p: ApprovalPolicy) => void;
}) {
  const { chainId, wallet, amountDtc, maxAmountDtc, onPolicyChange } = props;

  const fallbackCap = useMemo(() => {
    // sensible default: max of current amount and maxAmountDtc
    return Math.max(1, Math.min(maxAmountDtc, Math.max(amountDtc, 1)));
  }, [amountDtc, maxAmountDtc]);

  const [mode, setMode] = useState<ApprovalMode>("unlimited");
  const [capDtc, setCapDtc] = useState<number | null>(null);

  // load saved prefs (per chain + wallet)
  useEffect(() => {
    if (!wallet || !chainId) return;
    const pref = loadApprovalPrefs(chainId, wallet);
    setMode(pref.mode);
    setCapDtc(pref.capDtc);
  }, [chainId, wallet]);

  // whenever settings change, persist + notify parent
  useEffect(() => {
    if (!wallet || !chainId) return;
    saveApprovalPrefs(chainId, wallet, mode, capDtc);
    onPolicyChange(toPolicy(mode, capDtc, fallbackCap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, wallet, mode, capDtc, fallbackCap]);

  const capValue = capDtc ?? fallbackCap;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Approval</div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("limited")}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${
              mode === "limited" ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
            }`}
          >
            LIMITED
          </button>
          <button
            type="button"
            onClick={() => setMode("unlimited")}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${
              mode === "unlimited" ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
            }`}
          >
            UNLIMITED
          </button>
        </div>
      </div>

      {mode === "limited" && (
        <div className="mt-2">
          <div className="text-xs text-white/70">
            Approve up to a cap (DTC). Safer than unlimited approvals.
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              value={capValue}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (!Number.isFinite(n) || n <= 0) {
                  setCapDtc(null);
                  return;
                }
                setCapDtc(Math.max(1, Math.min(maxAmountDtc, n)));
              }}
              className="w-32 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            />
            <div className="text-xs text-white/60">max {maxAmountDtc.toLocaleString()} DTC</div>
          </div>

          <div className="mt-2 text-xs text-white/60">
            Current cap: <span className="text-white/80">{capValue.toLocaleString()} DTC</span>
          </div>
        </div>
      )}

      {mode === "unlimited" && (
        <div className="mt-2 text-xs text-white/70">
          Unlimited approvals are convenient but riskier. Use LIMITED if you prefer tighter control.
        </div>
      )}
    </div>
  );
}
