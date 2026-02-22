// app/profile/page.tsx
"use client";

import TopNav from "../components/TopNav";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useReadContract, useSwitchChain } from "wagmi";
import { zeroAddress, formatUnits } from "viem";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import { REF_REGISTRY_BY_CHAIN } from "../lib/addresses";
import { REFERRAL_REGISTRY_ABI } from "../lib/abi/referralRegistry";

const TOKEN_CHAIN_IDS = [59144, 8453] as const;
type TokenChainId = (typeof TOKEN_CHAIN_IDS)[number];

type TimeframeKey = "day" | "week" | "month" | "all";
type TimeframeApi = "daily" | "weekly" | "monthly" | "all";
type ChainKey = "base" | "linea";

type StoredProfile = {
  username?: string;
  joinedISO?: string;
  pfp?: {
    chainId: number;
    contract: `0x${string}`;
    tokenId: string;
    image?: string;
  };
};

const ERC721_ABI_MIN = [
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const SHARE_URL = "https://hop.donaldtoad.com/earn";

function tfKeyToApi(tf: TimeframeKey): TimeframeApi {
  if (tf === "day") return "daily";
  if (tf === "week") return "weekly";
  if (tf === "month") return "monthly";
  return "all";
}

function chainIdToKey(chainId: number): ChainKey {
  return chainId === 8453 ? "base" : "linea";
}

function isTokenChain(id: number | undefined): id is TokenChainId {
  return !!id && (TOKEN_CHAIN_IDS as readonly number[]).includes(id);
}

function truncateAddr(a?: string) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtNum(n: number, maxFrac = 6) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

function safeParseJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function storageKey(address?: string) {
  return `ll_profile_v1_${(address || "anon").toLowerCase()}`;
}

function usernameKey(address?: string) {
  return `ll_username_${(address || "anon").toLowerCase()}`;
}

function refCodeStorageKey(address: string, chainId: number) {
  return `ll_ref_code_${address.toLowerCase()}_${String(chainId)}`;
}

function normalizeUri(u: string) {
  if (!u) return "";
  if (u.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${u.slice("ipfs://".length)}`;
  return u;
}

function isAddressLike(v: string) {
  return typeof v === "string" && v.startsWith("0x") && v.length === 42;
}

function isNumericString(v: string) {
  return /^\d+$/.test(v);
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

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function buildShareText(code: string) {
  return `🐸 Lilypad Leap referral

Code:
${code}

Use it on:
${SHARE_URL}

Let’s hop 🎮`;
}

async function shareTextOrTweet(text: string) {
  const isMobile =
    typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

  if (isMobile && (navigator as any)?.share) {
    try {
      await (navigator as any).share({ text });
      return { ok: true as const, mode: "native" as const };
    } catch {}
  }

  const tweetText = text.replace(SHARE_URL, "").trim();
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    tweetText + "\n\n",
  )}&url=${encodeURIComponent(SHARE_URL)}`;

  try {
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
    return { ok: true as const, mode: "twitter" as const };
  } catch {
    return { ok: false as const, mode: "twitter" as const };
  }
}

function fmtShortDate(ms: number) {
  if (!ms) return "—";
  try {
    const d = new Date(ms);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function utcDayKey(ms: number) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const mm = String(m).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function utcMonthKey(ms: number) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const mm = String(m).padStart(2, "0");
  return `${y}-${mm}`;
}

function utcWeekKey(ms: number) {
  const d = new Date(ms);
  const dow = d.getUTCDay();
  const delta = (dow + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - delta, 0, 0, 0));
  const y = monday.getUTCFullYear();
  const m = monday.getUTCMonth() + 1;
  const day = monday.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type ChartPoint = {
  xLabel: string;
  profit: number | null;
  loss: number | null;
  cum: number;
};

function buildChartSeries(tf: TimeframeKey, gameRows: any[]): ChartPoint[] {
  const rows = [...(gameRows || [])]
    .filter((r) => Number(r?.timestamp || 0) > 0)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

  if (rows.length === 0) return [];

  if (tf === "all") {
    let cum = 0;
    return rows.map((r, i) => {
      const pnl = Number(r.pnlDtc || 0);
      cum += pnl;
      return {
        xLabel: String(i + 1),
        profit: pnl > 0 ? pnl : null,
        loss: pnl < 0 ? pnl : null,
        cum,
      };
    });
  }

  const buckets = new Map<
    string,
    { profit: number; loss: number; pnlSum: number; firstTs: number; lastTs: number }
  >();

  for (const r of rows) {
    const ts = Number(r.timestamp || 0);
    const pnl = Number(r.pnlDtc || 0);
    const k = tf === "day" ? utcDayKey(ts) : tf === "week" ? utcWeekKey(ts) : utcMonthKey(ts);

    if (!buckets.has(k)) buckets.set(k, { profit: 0, loss: 0, pnlSum: 0, firstTs: ts, lastTs: ts });
    const b = buckets.get(k)!;
    b.firstTs = Math.min(b.firstTs, ts);
    b.lastTs = Math.max(b.lastTs, ts);

    if (pnl > 0) b.profit += pnl;
    if (pnl < 0) b.loss += pnl;
    b.pnlSum += pnl;
  }

  const ordered = Array.from(buckets.entries())
    .map(([k, b]) => ({ k, ...b }))
    .sort((a, b) => a.firstTs - b.firstTs);

  let cum = 0;
  return ordered.map((b) => {
    cum += b.pnlSum;
    const label = tf === "month" ? b.k : b.k;
    return {
      xLabel: label,
      profit: b.profit > 0 ? b.profit : null,
      loss: b.loss < 0 ? b.loss : null,
      cum,
    };
  });
}

function extent(values: number[]) {
  if (!values.length) return { min: 0, max: 0 };
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.15);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
}

function toPath(data: { x: number; y: number }[]) {
  if (!data.length) return "";
  const parts: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    parts.push(`${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  }
  return parts.join(" ");
}

function SvgPnLChart({
  data,
  height = 280,
}: {
  data: ChartPoint[];
  height?: number;
}) {
  const w = 1000;
  const h = height;

  const padL = 54;
  const padR = 18;
  const padT = 18;
  const padB = 36;

  const profitVals = data.map((d) => (d.profit === null ? 0 : d.profit));
  const lossVals = data.map((d) => (d.loss === null ? 0 : d.loss));
  const cumVals = data.map((d) => d.cum);

  const allVals = [...profitVals, ...lossVals, ...cumVals, 0];
  const { min, max } = extent(allVals);

  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const xForIdx = (i: number) => {
    if (data.length <= 1) return padL + innerW / 2;
    return padL + (i / (data.length - 1)) * innerW;
  };

  const yForVal = (v: number) => {
    const t = (v - min) / (max - min);
    const y = padT + (1 - t) * innerH;
    return y;
  };

  const profitPts = data
    .map((d, i) => (d.profit === null ? null : ({ x: xForIdx(i), y: yForVal(d.profit) })))
    .filter(Boolean) as { x: number; y: number }[];

  const lossPts = data
    .map((d, i) => (d.loss === null ? null : ({ x: xForIdx(i), y: yForVal(d.loss) })))
    .filter(Boolean) as { x: number; y: number }[];

  const cumPts = data.map((d, i) => ({ x: xForIdx(i), y: yForVal(d.cum) }));

  const y0 = yForVal(0);

  const gridLines = 4;
  const yTicks = Array.from({ length: gridLines + 1 }, (_, i) => {
    const t = i / gridLines;
    const v = max - t * (max - min);
    return { y: padT + t * innerH, v };
  });

  const lastLabelEvery = data.length > 14 ? Math.ceil(data.length / 7) : 1;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-full w-full"
        role="img"
        aria-label="PnL chart"
      >
        <rect x={0} y={0} width={w} height={h} fill="transparent" />

        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={t.y}
              x2={w - padR}
              y2={t.y}
              stroke="#222"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={padL - 10} y={t.y + 4} textAnchor="end" fontSize="12" fill="#9ca3af">
              {fmtNum(t.v, 2)}
            </text>
          </g>
        ))}

        <line x1={padL} y1={y0} x2={w - padR} y2={y0} stroke="#2a2a2a" strokeWidth={1.2} />

        <path d={toPath(cumPts)} fill="none" stroke="#e5e7eb" strokeWidth={2.4} />

        <path d={toPath(profitPts)} fill="none" stroke="#22c55e" strokeWidth={2.6} />
        <path d={toPath(lossPts)} fill="none" stroke="#ef4444" strokeWidth={2.6} />

        <g>
          {data.map((d, i) => {
            if (i % lastLabelEvery !== 0 && i !== data.length - 1) return null;
            const x = xForIdx(i);
            return (
              <text key={i} x={x} y={h - 12} textAnchor="middle" fontSize="12" fill="#9ca3af">
                {d.xLabel}
              </text>
            );
          })}
        </g>
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-neutral-300">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#22c55e" }} />
          Profit
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} />
          Loss
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#e5e7eb" }} />
          Overall PnL
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted;

  const chains = useMemo(() => {
    const filtered = CHAIN_LIST.filter((c) => TOKEN_CHAIN_IDS.includes(c.chainId as any));
    const order: Record<number, number> = { 59144: 0, 8453: 1 };
    return [...filtered].sort((a, b) => (order[a.chainId] ?? 99) - (order[b.chainId] ?? 99));
  }, []);

  const allowedWalletChain = isTokenChain(walletChainId);
  const defaultChainId = allowedWalletChain ? walletChainId : PRIMARY_CHAIN.chainId;
  const [selectedChainId, setSelectedChainId] = useState<number>(defaultChainId);

  useEffect(() => {
    if (!ready) return;
    if (allowedWalletChain) setSelectedChainId(walletChainId);
  }, [ready, walletChainId, allowedWalletChain]);

  const selectedChain = useMemo(() => {
    return chains.find((c) => c.chainId === selectedChainId) ?? chains[0];
  }, [chains, selectedChainId]);

  const effectiveChainId = ready ? selectedChainId : undefined;

  const wrongWalletForSelected = useMemo(() => {
    if (!ready || !isConnected) return false;
    if (!effectiveChainId || !walletChainId) return false;
    return walletChainId !== effectiveChainId;
  }, [ready, isConnected, walletChainId, effectiveChainId]);

  const walletNetworkName = useMemo(() => {
    if (!ready || !walletChainId) return "—";
    return CHAIN_LIST.find((c) => c.chainId === walletChainId)?.name ?? String(walletChainId);
  }, [ready, walletChainId]);

  const onPickChain = useCallback(
    async (chainId: number) => {
      setSelectedChainId(chainId);
      if (!ready) return;
      if (!isConnected) return;
      try {
        await switchChainAsync?.({ chainId });
      } catch {}
    },
    [ready, isConnected, switchChainAsync],
  );

  const registryAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (REF_REGISTRY_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const readsEnabled = ready && isConnected && !!address && !wrongWalletForSelected && !!effectiveChainId;
  const tokenMode = readsEnabled && isTokenChain(effectiveChainId);

  const publicClientLinea = usePublicClient({ chainId: 59144 });
  const publicClientBase = usePublicClient({ chainId: 8453 });

  function publicClientForChain(chainId: number | undefined) {
    if (chainId === 59144) return publicClientLinea;
    if (chainId === 8453) return publicClientBase;
    return undefined;
  }

  const [profile, setProfile] = useState<StoredProfile>({});
  const [usernameDraft, setUsernameDraft] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const k = storageKey(address);
    const raw = safeParseJSON<StoredProfile>(window.localStorage.getItem(k)) ?? {};
    if (!raw.joinedISO && address) raw.joinedISO = new Date().toISOString();
    setProfile(raw);
    setUsernameDraft(raw.username ?? "");
    window.localStorage.setItem(k, JSON.stringify(raw));
    if (address && raw.username?.trim()) window.localStorage.setItem(usernameKey(address), raw.username.trim());
  }, [ready, address]);

  function saveProfile(next: StoredProfile) {
    setProfile(next);
    if (!ready) return;
    window.localStorage.setItem(storageKey(address), JSON.stringify(next));
    if (address && next.username?.trim()) window.localStorage.setItem(usernameKey(address), next.username.trim());
    else if (address) window.localStorage.removeItem(usernameKey(address));
  }

  const joinedLabel = useMemo(() => {
    const iso = profile.joinedISO;
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return "—";
    }
  }, [profile.joinedISO]);

  const username = profile.username?.trim() ? profile.username.trim() : "Player";
  const pfpFallback = "/profile/default.png";

  const [pfpImage, setPfpImage] = useState<string>("");
  const [pfpStatus, setPfpStatus] = useState<string>("");
  const [pfpErr, setPfpErr] = useState<string>("");

  useEffect(() => {
    if (!ready) return;
    setPfpImage(profile.pfp?.image || "");
  }, [ready, profile.pfp?.image]);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    setPfpErr("");
    setPfpStatus("");

    const pfp = profile.pfp;
    if (!pfp) {
      setPfpImage("");
      return () => {
        cancelled = true;
      };
    }

    const run = async (snap: NonNullable<StoredProfile["pfp"]>) => {
      try {
        if (!address) {
          setPfpErr("Connect wallet to verify NFT ownership.");
          setPfpImage("");
          return;
        }

        const pc = publicClientForChain(snap.chainId);
        if (!pc) {
          setPfpErr("Unsupported NFT chain.");
          setPfpImage("");
          return;
        }

        setPfpStatus("Verifying ownership…");

        const owner = (await pc.readContract({
          address: snap.contract,
          abi: ERC721_ABI_MIN,
          functionName: "ownerOf",
          args: [BigInt(snap.tokenId)],
        })) as `0x${string}`;

        if (owner.toLowerCase() !== address.toLowerCase()) {
          setPfpStatus("");
          setPfpErr("You don’t own this NFT on the connected wallet.");
          setPfpImage("");
          const next: StoredProfile = { ...profile, pfp: { ...snap, image: undefined } };
          if (!cancelled) saveProfile(next);
          return;
        }

        if (snap.image) {
          setPfpStatus("");
          setPfpImage(snap.image);
          return;
        }

        setPfpStatus("Loading NFT metadata…");

        const tokenUri = (await pc.readContract({
          address: snap.contract,
          abi: ERC721_ABI_MIN,
          functionName: "tokenURI",
          args: [BigInt(snap.tokenId)],
        })) as string;

        const resolvedTokenUri = normalizeUri(tokenUri);
        if (!resolvedTokenUri) {
          setPfpStatus("");
          setPfpErr("tokenURI() returned empty.");
          setPfpImage("");
          return;
        }

        const metaRes = await fetch(resolvedTokenUri, { cache: "no-store" });
        if (!metaRes.ok) {
          setPfpStatus("");
          setPfpErr(`Failed to fetch metadata. (HTTP ${metaRes.status})`);
          setPfpImage("");
          return;
        }

        const meta = (await metaRes.json()) as any;
        const img = normalizeUri(String(meta?.image || meta?.image_url || ""));
        if (!img) {
          setPfpStatus("");
          setPfpErr("Metadata has no image field.");
          setPfpImage("");
          return;
        }

        if (cancelled) return;
        setPfpImage(img);
        setPfpStatus("");
        const next: StoredProfile = { ...profile, pfp: { ...snap, image: img } };
        saveProfile(next);
      } catch (e: any) {
        if (cancelled) return;
        setPfpStatus("");
        setPfpErr(e?.shortMessage || e?.message || "Failed to load NFT.");
        setPfpImage("");
      }
    };

    void run(pfp);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, profile.pfp?.chainId, profile.pfp?.contract, profile.pfp?.tokenId, address]);

  const pfpSrc = pfpImage || pfpFallback;

  const [pfpOpen, setPfpOpen] = useState(false);
  const [pfpDraftChainId, setPfpDraftChainId] = useState<number>(TOKEN_CHAIN_IDS[0]);
  const [pfpDraftContract, setPfpDraftContract] = useState<string>("");
  const [pfpDraftTokenId, setPfpDraftTokenId] = useState<string>("");

  const [timeframe, setTimeframe] = useState<TimeframeKey>("week");
  const apiTf = useMemo(() => tfKeyToApi(timeframe), [timeframe]);

  const selectedChainKey = useMemo(() => {
    if (!effectiveChainId) return "linea" as ChainKey;
    return chainIdToKey(effectiveChainId);
  }, [effectiveChainId]);

  const [summary, setSummary] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!address) return;
    setSummaryLoading(true);
    try {
      const r = await fetch(
        `/api/profile-summary?address=${encodeURIComponent(address)}&tf=${encodeURIComponent(apiTf)}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      setSummary(j?.ok ? j : null);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [address, apiTf]);

  useEffect(() => {
    if (!ready || !isConnected || !address) return;
    void loadSummary();
  }, [ready, isConnected, address, apiTf, loadSummary]);

  const chainStats = useMemo(() => {
    if (!summary?.byChain) return null;
    return summary.byChain[selectedChainKey] ?? null;
  }, [summary, selectedChainKey]);

  const winRate = useMemo(() => {
    const w = Number(chainStats?.wins ?? 0);
    const l = Number(chainStats?.losses ?? 0);
    const t = w + l;
    if (!Number.isFinite(t) || t <= 0) return null;
    return (w / t) * 100;
  }, [chainStats]);

  const winRateClass = useMemo(() => {
    if (winRate === null) return "text-neutral-300";
    return winRate >= 50 ? "text-emerald-200" : "text-red-200";
  }, [winRate]);

  const [gamesPayload, setGamesPayload] = useState<any>(null);
  const [gamesLoading, setGamesLoading] = useState(false);

  const loadGames = useCallback(async () => {
    if (!address) return;
    setGamesLoading(true);
    try {
      const r = await fetch(
        `/api/profile-games?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(
          selectedChainKey,
        )}&tf=${encodeURIComponent(apiTf)}&limit=400`,
        { cache: "no-store" },
      );
      const j = await r.json();
      setGamesPayload(j?.ok ? j : null);
    } catch {
      setGamesPayload(null);
    } finally {
      setGamesLoading(false);
    }
  }, [address, selectedChainKey, apiTf]);

  useEffect(() => {
    if (!ready || !isConnected || !address) return;
    void loadGames();
  }, [ready, isConnected, address, selectedChainKey, apiTf, loadGames]);

  const chartSeries = useMemo(() => {
    const rows = (gamesPayload?.rows ?? []) as any[];
    return buildChartSeries(timeframe, rows);
  }, [gamesPayload, timeframe]);

  const latestGames = useMemo(() => {
    const rows = (gamesPayload?.rows ?? []) as any[];
    const sorted = [...rows].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    return sorted.slice(0, 10);
  }, [gamesPayload]);

  const { data: myRewardsTotal } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards_base",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled && registryAddress !== zeroAddress },
  });

  const totalClaimedLabel = useMemo(() => {
    try {
      const v = typeof myRewardsTotal === "bigint" ? myRewardsTotal : BigInt(String(myRewardsTotal ?? "0"));
      return fmtNum(Number(formatUnits(v, 18)), 6);
    } catch {
      return "—";
    }
  }, [myRewardsTotal]);

  const [refCode, setRefCode] = useState("");
  const [refStatus, setRefStatus] = useState("");
  const [refErr, setRefErr] = useState("");

  const refreshRefCode = useCallback(() => {
    if (!ready || !address || !effectiveChainId) return;
    try {
      const k = refCodeStorageKey(address, effectiveChainId);
      const v = window.localStorage.getItem(k)?.trim() || "";
      setRefCode(v);
    } catch {
      setRefCode("");
    }
  }, [ready, address, effectiveChainId]);

  useEffect(() => {
    if (!ready) return;
    refreshRefCode();
  }, [ready, refreshRefCode]);

  const canShare = useMemo(() => {
    return ready && isConnected && !!address && !!effectiveChainId && !wrongWalletForSelected && !!refCode;
  }, [ready, isConnected, address, effectiveChainId, wrongWalletForSelected, refCode]);

  const onCopyCode = useCallback(async () => {
    setRefErr("");
    setRefStatus("");
    if (!refCode) {
      setRefErr("No referral code found. Create it on Earn first.");
      return;
    }
    const ok = await copyText(refCode);
    if (ok) {
      setRefStatus("Code copied ✅");
      window.setTimeout(() => setRefStatus(""), 1200);
    } else setRefErr("Copy failed.");
  }, [refCode]);

  const onShare = useCallback(async () => {
    setRefErr("");
    setRefStatus("");
    if (!canShare) {
      setRefErr("No referral code found. Create it on Earn first.");
      return;
    }
    try {
      const msg = buildShareText(refCode);
      const r = await shareTextOrTweet(msg);
      if (r.ok) {
        setRefStatus(r.mode === "native" ? "Share opened ✅" : "Tweet draft opened ✅");
        window.setTimeout(() => setRefStatus(""), 1500);
      } else setRefErr("Share failed.");
    } catch (e: any) {
      setRefErr(e?.shortMessage || e?.message || "Share failed.");
    }
  }, [canShare, refCode]);

  const onGoEarn = useCallback(() => {
    try {
      window.location.href = "/earn";
    } catch {}
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="relative overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900/30 p-5 md:p-6">
          <div className="pointer-events-none absolute inset-0 opacity-40">
            <div className="absolute -top-24 left-1/2 h-64 w-[900px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
            <div className="absolute -bottom-28 left-1/2 h-64 w-[900px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
          </div>

          <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4">
              <div className="relative">
                <div className="h-16 w-16 overflow-hidden rounded-2xl ring-1 ring-neutral-800 bg-neutral-950">
                  <img src={pfpSrc} alt="Profile" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                </div>
                {pfpStatus ? (
                  <div className="mt-2 text-[11px] text-neutral-500">{pfpStatus}</div>
                ) : pfpErr ? (
                  <div className="mt-2 text-[11px] text-red-200">{pfpErr}</div>
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-extrabold leading-tight">{username}</h1>
                  {tokenMode ? (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/20">
                      Token mode
                    </span>
                  ) : (
                    <span className="rounded-full bg-neutral-800/40 px-2 py-0.5 text-[11px] font-semibold text-neutral-300 ring-1 ring-neutral-700/60">
                      Demo / Disconnected
                    </span>
                  )}
                </div>

                <div className="mt-1 text-sm text-neutral-300">
                  Wallet: <span className="font-mono">{truncateAddr(address)}</span>
                  <span className="text-neutral-600"> · </span>
                  Joined on <span className="text-neutral-200">{joinedLabel}</span>
                  <span className="text-neutral-600"> · </span>
                  Network:{" "}
                  <span className="text-neutral-200">
                    {selectedChain?.name ?? "—"}
                    {ready && isConnected && wrongWalletForSelected ? (
                      <span className="text-amber-200"> (wallet: {walletNetworkName})</span>
                    ) : null}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPfpOpen(true)}
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-900"
                  >
                    EDIT PFP
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-900"
                  >
                    EDIT USERNAME
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void loadSummary();
                      void loadGames();
                      refreshRefCode();
                    }}
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-900"
                  >
                    REFRESH
                  </button>
                </div>

                {address ? (
                  <div className="mt-2 text-[11px] text-neutral-500">
                    Leaderboard username key: <span className="font-mono">{usernameKey(address)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="w-full md:w-[360px]">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-[12px] font-semibold text-neutral-200">Network</div>
                <div className="mt-2 flex gap-2">
                  {chains.map((c) => {
                    const active = c.chainId === selectedChainId;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => void onPickChain(c.chainId)}
                        className={[
                          "flex-1 rounded-xl border px-3 py-2 text-left transition",
                          active ? "border-emerald-500/30 bg-emerald-500/10" : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-2">
                          <ChainIcon chainKey={c.key} alt={`${c.name} icon`} />
                          <div className="text-sm font-semibold">{c.name}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {ready && isConnected && wrongWalletForSelected ? (
                  <div className="mt-2 text-[11px] text-amber-200">Switch wallet network to match the selected chain.</div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {(["day", "week", "month", "all"] as TimeframeKey[]).map((k) => {
                    const active = timeframe === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTimeframe(k)}
                        className={[
                          "rounded-xl border px-3 py-2 text-xs font-extrabold",
                          active ? "border-neutral-200 bg-neutral-50 text-neutral-950" : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900",
                        ].join(" ")}
                      >
                        {k.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="relative mt-5 grid gap-3 md:grid-cols-5">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Games</div>
              <div className="mt-1 text-2xl font-extrabold">{summaryLoading ? "…" : fmtNum(chainStats?.games ?? 0, 0)}</div>
              <div className="mt-1 text-[11px] text-neutral-600">{selectedChain?.name ?? ""} · {apiTf}</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Wins / Losses</div>
              <div className="mt-1 text-2xl font-extrabold">
                {summaryLoading ? "…" : `${fmtNum(chainStats?.wins ?? 0, 0)} / ${fmtNum(chainStats?.losses ?? 0, 0)}`}
              </div>
              <div className="mt-1 text-[11px] text-neutral-600">Settled only</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Win Rate</div>
              <div className={["mt-1 text-2xl font-extrabold", winRateClass].join(" ")}>
                {winRate === null ? "—" : `${fmtNum(winRate, 2)}%`}
              </div>
              <div className="mt-1 text-[11px] text-neutral-600">{winRate === null ? "No games yet" : winRate >= 50 ? "Above 50%" : "Below 50%"}</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Volume</div>
              <div className="mt-1 text-2xl font-extrabold">{summaryLoading ? "…" : `${fmtNum(chainStats?.volumeDtc ?? 0, 2)} DTC`}</div>
              <div className="mt-1 text-[11px] text-neutral-600">Amount received</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">PnL</div>
              <div className="mt-1 text-2xl font-extrabold">{summaryLoading ? "…" : `${fmtNum(chainStats?.profitDtc ?? 0, 2)} DTC`}</div>
              <div className="mt-1 text-[11px] text-neutral-600">playerNetWin</div>
            </div>
          </div>

          <div className="relative mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Top Win</div>
              <div className="mt-1 text-2xl font-extrabold">{summaryLoading ? "…" : `${fmtNum(chainStats?.topWinDtc ?? 0, 2)} DTC`}</div>
              <div className="mt-1 text-[11px] text-neutral-600">{apiTf}</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Referrals</div>
              <div className="mt-1 text-2xl font-extrabold">{summaryLoading ? "…" : fmtNum(chainStats?.referrals ?? 0, 0)}</div>
              <div className="mt-1 text-[11px] text-neutral-600">Bound referees</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Claimed (events)</div>
              <div className="mt-1 text-2xl font-extrabold">{summaryLoading ? "…" : `${fmtNum(chainStats?.claimedDtc ?? 0, 2)} DTC`}</div>
              <div className="mt-1 text-[11px] text-neutral-600">Claimed logs</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Total claimed (registry)</div>
              <div className="mt-1 text-2xl font-extrabold">{tokenMode ? `${totalClaimedLabel} DTC` : "—"}</div>
              <div className="mt-1 text-[11px] text-neutral-600">referrer_total_rewards_base</div>
            </div>
          </div>

          <div className="relative mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 md:col-span-1">
              <div className="text-sm font-semibold text-neutral-100">Referral (share)</div>
              <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3">
                <div className="text-[11px] text-neutral-500">Your code</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="min-w-0 font-mono text-[13px] text-neutral-100">
                    {refCode ? refCode : <span className="text-neutral-600">No code yet</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => void onCopyCode()}
                    disabled={!refCode}
                    className={[
                      "shrink-0 rounded-xl border px-3 py-2 text-[11px] font-extrabold",
                      refCode
                        ? "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60"
                        : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                    ].join(" ")}
                  >
                    COPY
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void onShare()}
                    disabled={!canShare}
                    className={[
                      "rounded-xl border px-3 py-2 text-[11px] font-extrabold",
                      canShare
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                        : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                    ].join(" ")}
                  >
                    SHARE
                  </button>

                  <button
                    type="button"
                    onClick={() => onGoEarn()}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-[11px] font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                  >
                    GO TO EARN
                  </button>
                </div>

                {refStatus ? <div className="mt-2 text-[11px] text-emerald-200">{refStatus}</div> : null}
                {refErr ? <div className="mt-2 text-[11px] text-red-200">{refErr}</div> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 md:col-span-2">
              <div className="text-sm font-semibold text-neutral-100">PnL chart</div>
              <div className="mt-1 text-[12px] text-neutral-500">
                Green = profit · Red = loss · White = overall PnL ({timeframe.toUpperCase()} aggregation)
              </div>

              <div className="mt-3 w-full rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                {gamesLoading ? (
                  <div className="flex h-[280px] items-center justify-center text-sm text-neutral-400">Loading chart…</div>
                ) : chartSeries.length < 2 ? (
                  <div className="flex h-[280px] items-center justify-center text-sm text-neutral-400">Not enough games to chart.</div>
                ) : (
                  <SvgPnLChart data={chartSeries} height={280} />
                )}
              </div>

              <div className="mt-2 text-[11px] text-neutral-600">
                Daily/Weekly/Monthly = bucket sums (UTC). All = per-game points.
              </div>
            </div>
          </div>

          <div className="relative mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Latest games</div>
                <div className="mt-1 text-[12px] text-neutral-500">Real entries from GameSettled logs.</div>
              </div>
              <span className="text-[11px] text-neutral-600">Only settled games emit GameSettled.</span>
            </div>

            {gamesLoading ? (
              <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-400">
                Loading…
              </div>
            ) : latestGames.length === 0 ? (
              <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-400">
                No games found for this timeframe.
              </div>
            ) : (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {latestGames.map((g: any, idx: number) => {
                  const pnl = Number(g.pnlDtc || 0);
                  const pnlCls = pnl >= 0 ? "text-emerald-200" : "text-red-200";
                  const tx = typeof g.txHash === "string" ? g.txHash : "";
                  const txShort = tx ? `${tx.slice(0, 10)}…${tx.slice(-8)}` : "—";
                  return (
                    <div key={`${g.gameId || idx}-${idx}`} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-neutral-100">{g.mode?.toUpperCase?.() || "GAME"}</div>
                        <div className="text-neutral-500">{fmtShortDate(Number(g.timestamp || 0))}</div>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2 text-neutral-300">
                        <div>
                          Bet: <span className="font-semibold text-neutral-100">{fmtNum(Number(g.wagerDtc || 0), 4)} DTC</span>
                        </div>
                        <div>
                          Payout: <span className="font-semibold text-neutral-100">{fmtNum(Number(g.payoutDtc || 0), 4)} DTC</span>
                        </div>
                        <div>
                          Result:{" "}
                          <span className={pnl >= 0 ? "text-emerald-200 font-semibold" : "text-red-200 font-semibold"}>
                            {String(g.status || "").toUpperCase() || "—"}
                          </span>
                        </div>
                        <div>
                          PnL: <span className={["font-semibold", pnlCls].join(" ")}>{fmtNum(pnl, 4)} DTC</span>
                        </div>
                      </div>

                      <div className="mt-2 text-neutral-500">
                        Tx: <span className="font-mono text-neutral-300">{txShort}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-950 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-extrabold">Edit username</div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
              >
                CLOSE
              </button>
            </div>

            <div className="mt-4">
              <label className="text-[12px] text-neutral-400">Username</label>
              <input
                value={usernameDraft}
                onChange={(e) => setUsernameDraft(e.target.value)}
                placeholder="Toad Jones"
                className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
              <div className="mt-2 text-[11px] text-neutral-500">
                Stored locally + duplicated to <span className="font-mono">ll_username_&lt;address&gt;</span> for leaderboard.
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const next: StoredProfile = { ...profile, username: usernameDraft.trim() || undefined };
                  saveProfile(next);
                  setEditOpen(false);
                }}
                className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-extrabold text-emerald-200 hover:bg-emerald-500/15"
              >
                SAVE
              </button>
              <button
                type="button"
                onClick={() => {
                  setUsernameDraft(profile.username ?? "");
                  setEditOpen(false);
                }}
                className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pfpOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-neutral-800 bg-neutral-950 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-extrabold">Import NFT PFP (ERC-721)</div>
              <button
                type="button"
                onClick={() => setPfpOpen(false)}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
              >
                CLOSE
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-3 text-[12px] text-neutral-300">
              Stored only on your device. Ownership verified via <span className="font-mono">ownerOf(tokenId)</span>.
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="md:col-span-1">
                <label className="text-[12px] text-neutral-400">Chain</label>
                <select
                  value={pfpDraftChainId}
                  onChange={(e) => setPfpDraftChainId(Number(e.target.value))}
                  className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3 text-sm text-neutral-100 outline-none"
                >
                  <option value={59144}>Linea</option>
                  <option value={8453}>Base</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="text-[12px] text-neutral-400">NFT Contract (0x…)</label>
                <input
                  value={pfpDraftContract}
                  onChange={(e) => setPfpDraftContract(e.target.value.trim())}
                  placeholder="0xabc…"
                  className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none"
                />

                <label className="mt-3 block text-[12px] text-neutral-400">Token ID</label>
                <input
                  value={pfpDraftTokenId}
                  onChange={(e) => setPfpDraftTokenId(e.target.value.trim())}
                  placeholder="1234"
                  className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none"
                />

                <div className="mt-2 text-[11px] text-neutral-500">Saved locally under your wallet address.</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPfpErr("");
                  setPfpStatus("");

                  if (!address) {
                    setPfpErr("Connect your wallet first (needed to verify ownership).");
                    return;
                  }

                  const c = pfpDraftContract as `0x${string}`;
                  const okAddr = isAddressLike(c);
                  const okId = !!pfpDraftTokenId && isNumericString(pfpDraftTokenId);

                  if (!okAddr || !okId) {
                    setPfpErr("Please enter a valid contract address and numeric token ID.");
                    return;
                  }

                  const next: StoredProfile = {
                    ...profile,
                    pfp: { chainId: pfpDraftChainId, contract: c, tokenId: pfpDraftTokenId, image: undefined },
                  };

                  saveProfile(next);
                  setPfpOpen(false);
                }}
                className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-extrabold text-emerald-200 hover:bg-emerald-500/15"
              >
                SAVE PFP
              </button>

              <button
                type="button"
                onClick={() => {
                  setPfpDraftContract("");
                  setPfpDraftTokenId("");
                  setPfpOpen(false);
                }}
                className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
              >
                CANCEL
              </button>
            </div>

            {profile.pfp ? (
              <button
                type="button"
                onClick={() => {
                  const next = { ...profile };
                  delete next.pfp;
                  saveProfile(next);
                  setPfpImage("");
                  setPfpErr("");
                  setPfpStatus("");
                  setPfpOpen(false);
                }}
                className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
              >
                REMOVE PFP
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}