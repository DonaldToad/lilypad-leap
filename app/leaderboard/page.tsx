"use client";

import TopNav from "../components/TopNav";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";

type Timeframe = "daily" | "weekly" | "monthly" | "all";
type ChainKey = "base" | "linea";

type ApiRow = {
  chains: ChainKey[];
  address: `0x${string}`;
  games: number;
  volumeDtc: number;
  topWinDtc: number;
  profitDtc: number;
  referrals: number;
  claimedDtc: number;
};

type ApiPayload = {
  ok: boolean;
  tf: Timeframe;
  rows: ApiRow[];
  meta?: { source?: string; cached?: boolean; asOfMs?: number };
};

type StoredProfile = {
  username?: string;
  joinedISO?: string;
  pfp?: { chainId: number; contract: `0x${string}`; tokenId: string; image?: string };
};

function truncateAddr(a?: string) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtNum(n: number, maxFrac = 6) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtPrice(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "—";
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 8 });
  return `$${s}`;
}

function safeParseJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function profileKey(address?: string) {
  return `ll_profile_v1_${(address || "anon").toLowerCase()}`;
}

function usernameKey(address?: string) {
  return `ll_username_${(address || "anon").toLowerCase()}`;
}

function ChainIcon({ chainKey, alt }: { chainKey: string; alt: string }) {
  const src = `/chains/${chainKey}.png`;
  return (
    <img
      src={src}
      alt={alt}
      width={22}
      height={22}
      className="h-[22px] w-[22px] rounded-md ring-1 ring-neutral-800"
      loading="lazy"
      decoding="async"
    />
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-neutral-950/60 backdrop-blur-[2px]">
      <div className="w-full max-w-2xl px-6">
        <div className="mx-auto flex flex-col items-center justify-center gap-3">
          <div className="flex items-center gap-3">
            <div className="text-3xl sm:text-4xl animate-hourglass">⏳</div>
            <div className="text-xl sm:text-2xl font-extrabold tracking-tight text-neutral-100 animate-pulse">
              Loading leaderboard…
            </div>
          </div>
          <div className="text-sm text-neutral-300/90">Crunching Base + Linea stats 🐸</div>
        </div>

        <div className="mt-6 grid gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden relative"
            >
              <div className="absolute inset-0 shimmer" />
              <div className="relative h-full flex items-center justify-between px-4">
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-md bg-neutral-800/70" />
                  <div className="h-4 w-36 rounded-md bg-neutral-800/70" />
                </div>
                <div className="h-4 w-24 rounded-md bg-neutral-800/70" />
              </div>
            </div>
          ))}
        </div>

        <style jsx global>{`
          @keyframes hourglassSpin {
            0% {
              transform: rotate(0deg) scale(1);
              opacity: 0.95;
            }
            50% {
              transform: rotate(180deg) scale(1.08);
              opacity: 1;
            }
            100% {
              transform: rotate(360deg) scale(1);
              opacity: 0.95;
            }
          }
          .animate-hourglass {
            animation: hourglassSpin 1.1s linear infinite;
            transform-origin: 50% 50%;
          }

          @keyframes shimmerMove {
            0% {
              transform: translateX(-60%);
              opacity: 0.35;
            }
            100% {
              transform: translateX(140%);
              opacity: 0.35;
            }
          }
          .shimmer {
            background: linear-gradient(
              90deg,
              rgba(255, 255, 255, 0) 0%,
              rgba(255, 255, 255, 0.07) 35%,
              rgba(255, 255, 255, 0.14) 50%,
              rgba(255, 255, 255, 0.07) 65%,
              rgba(255, 255, 255, 0) 100%
            );
            animation: shimmerMove 1.15s ease-in-out infinite;
            width: 70%;
          }
        `}</style>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { address, isConnected } = useAccount();

  const [tf, setTf] = useState<Timeframe>("weekly");
  const [metric, setMetric] = useState<"volume" | "usd" | "topwin" | "referrals" | "claimed">("volume");
  const [winnersOnly, setWinnersOnly] = useState(false);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<ApiPayload | null>(null);

  const [dtcUsd, setDtcUsd] = useState<number | null>(null);

  const [myUsername, setMyUsername] = useState<string>("");
  const [myPfp, setMyPfp] = useState<string>("");

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isConnected || !address) {
      setMyUsername("");
      setMyPfp("");
      return;
    }
    const u = window.localStorage.getItem(usernameKey(address));
    setMyUsername((u || "").trim());

    const prof = safeParseJSON<StoredProfile>(window.localStorage.getItem(profileKey(address)));
    const img = String(prof?.pfp?.image || "");
    setMyPfp(img && img !== "/profile/default.png" ? img : "");
  }, [isConnected, address]);

  const loadLeaderboard = useCallback(async (t: Timeframe) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/leaderboard?tf=${encodeURIComponent(t)}`, { cache: "no-store" });
      const j = (await r.json()) as ApiPayload;
      if (!mountedRef.current) return;
      setPayload(j?.ok ? j : { ok: false, tf: t, rows: [] });
    } catch {
      if (!mountedRef.current) return;
      setPayload({ ok: false, tf: t, rows: [] });
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, []);

  const loadPrice = useCallback(async () => {
    try {
      const r = await fetch(`/api/dtc-price`, { cache: "no-store" });
      const j = (await r.json()) as any;
      const v = Number(j?.usd);
      if (!mountedRef.current) return;
      setDtcUsd(Number.isFinite(v) ? v : null);
    } catch {
      if (!mountedRef.current) return;
      setDtcUsd(null);
    }
  }, []);

  useEffect(() => {
    void loadLeaderboard(tf);
  }, [tf, loadLeaderboard]);

  useEffect(() => {
    void loadPrice();
    const id = window.setInterval(() => void loadPrice(), 60_000);
    return () => window.clearInterval(id);
  }, [loadPrice]);

  const rows = useMemo(() => payload?.rows ?? [], [payload]);

  const valueForRow = useCallback(
    (r: ApiRow) => {
      if (metric === "volume") return r.volumeDtc;
      if (metric === "usd") return dtcUsd ? r.volumeDtc * dtcUsd : 0;
      if (metric === "topwin") return r.topWinDtc;
      if (metric === "referrals") return r.referrals;
      return r.claimedDtc;
    },
    [metric, dtcUsd],
  );

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const me = (address || "").toLowerCase();

    let out = [...rows];

    if (winnersOnly) {
      out = out.filter((r) => (r.topWinDtc || 0) > 0);
    }

    if (q) {
      out = out.filter((r) => {
        const a = r.address.toLowerCase();
        return a.includes(q) || truncateAddr(a).toLowerCase().includes(q);
      });
    }

    out.sort((a, b) => {
      const av = valueForRow(a);
      const bv = valueForRow(b);
      const d = bv - av;
      return sortDir === "desc" ? d : -d;
    });

    out = out.filter((r) => {
      if (!me) return true;
      return true;
    });

    return out;
  }, [rows, winnersOnly, query, sortDir, valueForRow, address]);

  const totals = useMemo(() => {
    const totalGames = filteredSorted.reduce((s, r) => s + (r.games || 0), 0);
    const totalVolDtc = filteredSorted.reduce((s, r) => s + (r.volumeDtc || 0), 0);
    const totalUsd = dtcUsd ? totalVolDtc * dtcUsd : 0;
    return { totalGames, totalVolDtc, totalUsd };
  }, [filteredSorted, dtcUsd]);

  const metricLabel = useMemo(() => {
    if (metric === "volume") return "Most wagered (DTC)";
    if (metric === "usd") return "Most wagered (USD)";
    if (metric === "topwin") return "Top win (DTC)";
    if (metric === "referrals") return "Referrals";
    return "Claimed (DTC)";
  }, [metric]);

  const isMe = useCallback(
    (addr: string) => {
      if (!address) return false;
      return addr.toLowerCase() === address.toLowerCase();
    },
    [address],
  );

  const displayName = useCallback(
    (r: ApiRow) => {
      if (isMe(r.address)) return (myUsername || "you").trim();
      return truncateAddr(r.address);
    },
    [isMe, myUsername],
  );

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="relative rounded-3xl border border-neutral-800 bg-neutral-900/30 p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Leaderboard 🏆</h1>
              <div className="mt-1 text-sm text-neutral-300">Unified across Base + Linea. Periods are UTC.</div>
              <div className="mt-2 text-sm text-neutral-300">
                Metric: <span className="text-neutral-100 font-semibold">{metricLabel}</span>
              </div>
              <div className="mt-1 text-[12px] text-neutral-400">
                DTC price: <span className="font-semibold text-neutral-200">{fmtPrice(dtcUsd)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:items-end">
              <div className="flex flex-wrap items-center gap-2">
                {(["daily", "weekly", "monthly", "all"] as Timeframe[]).map((k) => {
                  const active = tf === k;
                  const label =
                    k === "daily" ? "Daily (UTC)" : k === "weekly" ? "Weekly (UTC)" : k === "monthly" ? "Monthly (UTC)" : "All Time";
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTf(k)}
                      className={[
                        "rounded-xl border px-3 py-2 text-xs font-extrabold",
                        active
                          ? "border-neutral-200 bg-neutral-50 text-neutral-950"
                          : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMetric("volume")}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs font-extrabold",
                      metric === "volume"
                        ? "border-neutral-200 bg-neutral-50 text-neutral-950"
                        : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900",
                    ].join(" ")}
                  >
                    Volumes
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetric("usd")}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs font-extrabold",
                      metric === "usd"
                        ? "border-neutral-200 bg-neutral-50 text-neutral-950"
                        : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900",
                    ].join(" ")}
                  >
                    USD Volumes
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetric("topwin")}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs font-extrabold",
                      metric === "topwin"
                        ? "border-neutral-200 bg-neutral-50 text-neutral-950"
                        : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900",
                    ].join(" ")}
                  >
                    Top Wins
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetric("referrals")}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs font-extrabold",
                      metric === "referrals"
                        ? "border-neutral-200 bg-neutral-50 text-neutral-950"
                        : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900",
                    ].join(" ")}
                  >
                    Referrals
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetric("claimed")}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs font-extrabold",
                      metric === "claimed"
                        ? "border-neutral-200 bg-neutral-50 text-neutral-950"
                        : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900",
                    ].join(" ")}
                  >
                    Claimed
                  </button>
                </div>

                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search wallet…"
                  className="h-10 w-[280px] max-w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:ring-2 focus:ring-emerald-500/30"
                />

                <button
                  type="button"
                  onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                  className="h-10 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 text-xs font-extrabold text-neutral-200 hover:bg-neutral-900"
                >
                  Sort: {sortDir === "desc" ? "High → Low" : "Low → High"}
                </button>

                <button
                  type="button"
                  onClick={() => setWinnersOnly((v) => !v)}
                  className="h-10 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 text-xs font-extrabold text-neutral-200 hover:bg-neutral-900"
                >
                  {winnersOnly ? "Winners only: ON" : "Winners only"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Rows</div>
              <div className="mt-1 text-2xl font-extrabold">{filteredSorted.length}</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Total Volume</div>
              <div className="mt-1 text-2xl font-extrabold">{fmtNum(totals.totalVolDtc, 2)} DTC</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Total USD Volume</div>
              <div className="mt-1 text-2xl font-extrabold">{dtcUsd ? fmtUsd(totals.totalUsd) : "—"}</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Games</div>
              <div className="mt-1 text-2xl font-extrabold">{fmtNum(totals.totalGames, 0)}</div>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[12px] text-neutral-400">
                Showing <span className="font-semibold text-neutral-200">{tf === "all" ? "All Time" : tf}</span> ·{" "}
                <span className="font-semibold text-neutral-200">{filteredSorted.length}</span> rows
              </div>
              <div className="text-[12px] text-neutral-500">{payload?.meta?.source ? `Source: ${payload.meta.source}` : ""}</div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[980px] w-full text-left">
                <thead>
                  <tr className="text-[12px] text-neutral-400">
                    <th className="py-3 pr-4">#</th>
                    <th className="py-3 pr-4">Chain</th>
                    <th className="py-3 pr-4">Player</th>
                    <th className="py-3 pr-4">Games</th>
                    <th className="py-3 pr-4">Volume</th>
                    <th className="py-3 pr-4">USD Volume</th>
                    <th className="py-3 pr-4">Top Win</th>
                    <th className="py-3 pr-4">Referrals</th>
                    <th className="py-3 pr-4">Claimed</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredSorted.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-sm text-neutral-400">
                        No results.
                      </td>
                    </tr>
                  ) : (
                    filteredSorted.map((r, idx) => {
                      const mine = isMe(r.address);
                      const usdVol = dtcUsd ? r.volumeDtc * dtcUsd : 0;

                      return (
                        <tr
                          key={`${r.address}-${idx}`}
                          className={[
                            "border-t border-neutral-800/70",
                            mine ? "bg-emerald-500/5" : "hover:bg-neutral-900/40",
                          ].join(" ")}
                        >
                          <td className="py-4 pr-4 align-middle">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-extrabold text-neutral-100">{idx + 1}</div>
                              {mine ? (
                                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-extrabold text-emerald-200">
                                  ✨ you
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td className="py-4 pr-4 align-middle">
                            <div className="flex items-center gap-2">
                              {r.chains.map((c) => (
                                <ChainIcon key={c} chainKey={c} alt={`${c} icon`} />
                              ))}
                            </div>
                          </td>

                          <td className="py-4 pr-4 align-middle">
                            <div className="flex items-center gap-3">
                              {mine && myPfp ? (
                                <div className="h-8 w-8 overflow-hidden rounded-xl ring-1 ring-neutral-800 bg-neutral-950">
                                  <img
                                    src={myPfp}
                                    alt="PFP"
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                </div>
                              ) : null}

                              <div className="min-w-0">
                                <div className="truncate text-sm font-extrabold text-neutral-100">{displayName(r)}</div>
                                <div className="mt-0.5 text-[12px] font-mono text-neutral-500">
                                  {mine ? truncateAddr(address) : truncateAddr(r.address)}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-4 pr-4 align-middle text-sm font-semibold text-neutral-100">{fmtNum(r.games, 0)}</td>

                          <td className="py-4 pr-4 align-middle text-sm font-extrabold text-neutral-100">
                            {fmtNum(r.volumeDtc, 2)} DTC
                          </td>

                          <td className="py-4 pr-4 align-middle text-sm font-extrabold text-neutral-100">
                            {dtcUsd ? fmtUsd(usdVol) : "—"}
                          </td>

                          <td className="py-4 pr-4 align-middle text-sm font-semibold text-neutral-100">
                            {fmtNum(r.topWinDtc, 2)} DTC
                          </td>

                          <td className="py-4 pr-4 align-middle text-sm font-semibold text-neutral-100">{fmtNum(r.referrals, 0)}</td>

                          <td className="py-4 pr-4 align-middle text-sm font-semibold text-neutral-100">
                            {fmtNum(r.claimedDtc, 2)} DTC
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {loading ? <LoadingOverlay /> : null}
        </div>
      </section>
    </main>
  );
}