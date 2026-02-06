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
    return Math.max(1, Math.min(maxAmountDtc, Math.max(amountDtc, 1)));
  }, [amountDtc, maxAmountDtc]);

  const [mode, setMode] = useState<ApprovalMode>("unlimited");
  const [capDtc, setCapDtc] = useState<number | null>(null);

  useEffect(() => {
    if (!wallet || !chainId) return;
    const pref = loadApprovalPrefs(chainId, wallet);
    setMode(pref?.mode === "limited" ? "limited" : "unlimited");
    setCapDtc(pref?.capDtc ?? null);
  }, [chainId, wallet]);

  useEffect(() => {
    if (!wallet || !chainId) return;
    saveApprovalPrefs(chainId, wallet, mode, capDtc);
    onPolicyChange(toPolicy(mode, capDtc, fallbackCap));
  }, [chainId, wallet, mode, capDtc, fallbackCap]);

  const capValue = Math.max(1, Math.min(maxAmountDtc, capDtc ?? fallbackCap));

  const base =
    "rounded-xl border px-3 py-3 transition text-left";

  const activeUnlimited =
    "border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_0_18px_rgba(16,185,129,0.08)]";

  const activeLimited =
    "border-amber-500/30 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.15),0_0_14px_rgba(245,158,11,0.08)]";

  const inactive =
    "border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/40 opacity-90";

  return (
    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/20 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-extrabold text-neutral-100">Approval</div>
        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
          Recommended
        </span>
      </div>

      {/* UNLIMITED (primary) */}
      <button
        type="button"
        onClick={() => setMode("unlimited")}
        className={[
          base,
          "mt-2",
          mode === "unlimited" ? activeUnlimited : inactive,
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <div className="text-xs font-extrabold text-neutral-50">
            UNLIMITED
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
              less gas
            </span>

            <span
              className={[
                "h-5 w-5 rounded-full border flex items-center justify-center text-[11px] font-black",
                mode === "unlimited"
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
                  : "border-neutral-800 bg-neutral-900 text-neutral-400",
              ].join(" ")}
            >
              ✓
            </span>
          </div>
        </div>

        <div className="mt-1 text-[11px] text-neutral-400">
          One approval. Smooth gameplay.
        </div>
      </button>

      {/* LIMITED (secondary) */}
      <button
        type="button"
        onClick={() => setMode("limited")}
        className={[
          base,
          "mt-2",
          mode === "limited" ? activeLimited : inactive,
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <div className="text-xs font-extrabold text-neutral-50">
            LIMITED
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
              safer
            </span>

            <span
              className={[
                "h-5 w-5 rounded-full border flex items-center justify-center text-[11px] font-black",
                mode === "limited"
                  ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
                  : "border-neutral-800 bg-neutral-900 text-neutral-400",
              ].join(" ")}
            >
              ✓
            </span>
          </div>
        </div>

        {mode === "limited" && (
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
              className="w-24 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-50 outline-none focus:border-neutral-700"
            />
            <div className="text-[10px] text-neutral-500">
              max {maxAmountDtc.toLocaleString()}
            </div>
          </div>
        )}
      </button>

      <div className="mt-2 text-[10px] text-neutral-500">
        Unlimited = fewer approvals. Limited = tighter control.
      </div>
    </div>
  );
}
