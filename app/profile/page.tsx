// app/profile/page.tsx
"use client";

import TopNav from "../components/TopNav";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
} from "wagmi";
import {
  zeroAddress,
  formatUnits,
  keccak256,
  encodePacked,
  type Hex,
  isHex,
} from "viem";

import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";
import { LILYPAD_VAULT_BY_CHAIN, REF_REGISTRY_BY_CHAIN } from "../lib/addresses";
import { LILYPAD_VAULT_ABI } from "../lib/abi/lilypadVault";
import { REFERRAL_REGISTRY_ABI } from "../lib/abi/referralRegistry";

const TOKEN_CHAIN_IDS = [59144, 8453] as const;
type TokenChainId = (typeof TOKEN_CHAIN_IDS)[number];

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

/** Minimal ERC-721 ABI: tokenURI + ownerOf */
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

function normalizeUri(u: string) {
  if (!u) return "";
  if (u.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${u.slice("ipfs://".length)}`;
  return u;
}

type StoredProfile = {
  username?: string;
  joinedISO?: string;

  // Local-only NFT PFP selection + cached image URL
  pfp?: {
    chainId: number;
    contract: `0x${string}`;
    tokenId: string; // keep as string
    image?: string; // cached resolved image URL
  };
};

function storageKey(address?: string) {
  return `ll_profile_v1_${(address || "anon").toLowerCase()}`;
}

function safeParseJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function isAddressLike(v: string) {
  return typeof v === "string" && v.startsWith("0x") && v.length === 42;
}

function isNumericString(v: string) {
  return /^\d+$/.test(v);
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted;

  // UI chains (Linea + Base)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, walletChainId]);

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

  async function onPickChain(chainId: number) {
    setSelectedChainId(chainId);
    if (!ready) return;
    if (!isConnected) return;
    try {
      await switchChainAsync?.({ chainId });
    } catch {
      // keep silent
    }
  }

  // Public clients:
  // - One for current selected chain (for vault + registry reads)
  // - Two dedicated for NFT chain (so PFP loads no matter what selected chain is)
  const publicClient = usePublicClient({ chainId: effectiveChainId });
  const publicClientLinea = usePublicClient({ chainId: 59144 });
  const publicClientBase = usePublicClient({ chainId: 8453 });

  function publicClientForChain(chainId: number | undefined) {
    if (chainId === 59144) return publicClientLinea;
    if (chainId === 8453) return publicClientBase;
    return undefined;
  }

  // Addresses (by selected chain)
  const vaultAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (LILYPAD_VAULT_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  const registryAddress = useMemo(() => {
    if (!effectiveChainId) return zeroAddress as `0x${string}`;
    return (REF_REGISTRY_BY_CHAIN[effectiveChainId] ?? zeroAddress) as `0x${string}`;
  }, [effectiveChainId]);

  // ===== Local profile =====
  const [profile, setProfile] = useState<StoredProfile>({});
  const [editOpen, setEditOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [pfpOpen, setPfpOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const k = storageKey(address);
    const raw = safeParseJSON<StoredProfile>(window.localStorage.getItem(k)) ?? {};

    if (!raw.joinedISO && address) raw.joinedISO = new Date().toISOString();

    setProfile(raw);
    setUsernameDraft(raw.username ?? "");
    window.localStorage.setItem(k, JSON.stringify(raw));
  }, [ready, address]);

  function saveProfile(next: StoredProfile) {
    setProfile(next);
    if (!ready) return;
    window.localStorage.setItem(storageKey(address), JSON.stringify(next));
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

  // Proof hash (device-side deterministic placeholder)
  const proofIdHash = useMemo(() => {
    if (!ready || !address || !effectiveChainId) return "";
    try {
      return keccak256(encodePacked(["address", "uint256"], [address, BigInt(effectiveChainId)]));
    } catch {
      return "";
    }
  }, [ready, address, effectiveChainId]);

  // ===== On-chain reads (selected chain) =====
  const readsEnabled =
    ready && isConnected && !!address && !wrongWalletForSelected && !!effectiveChainId;

  const tokenMode = readsEnabled && isTokenChain(effectiveChainId);

  const { data: gamesLen } = useReadContract({
    chainId: effectiveChainId,
    abi: LILYPAD_VAULT_ABI,
    address: vaultAddress,
    functionName: "getUserGamesLength",
    args: address ? [address] : [zeroAddress],
    query: { enabled: readsEnabled && vaultAddress !== zeroAddress },
  });

  const { data: owedWei } = useReadContract({
    chainId: effectiveChainId,
    abi: LILYPAD_VAULT_ABI,
    address: vaultAddress,
    functionName: "owed",
    args: address ? [address] : [zeroAddress],
    query: { enabled: readsEnabled && vaultAddress !== zeroAddress },
  });

  const owedDtcLabel = useMemo(() => {
    const v = (owedWei as bigint | undefined) ?? 0n;
    return fmtNum(Number(formatUnits(v, 18)), 6);
  }, [owedWei]);

  const { data: myRewardsTotal } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI,
    address: registryAddress,
    functionName: "referrer_total_rewards",
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled && registryAddress !== zeroAddress },
  });

  const totalClaimedReferralsLabel = useMemo(() => {
    const v = (myRewardsTotal as any) ?? 0n;
    try {
      return fmtNum(Number(formatUnits(BigInt(v.toString()), 18)), 6);
    } catch {
      return "—";
    }
  }, [myRewardsTotal]);

  // Optional: referral count if your registry supports it
  const { data: referralsCountMaybe, error: referralsCountErr } = useReadContract({
    chainId: effectiveChainId,
    abi: REFERRAL_REGISTRY_ABI as any,
    address: registryAddress,
    functionName: "referrer_total_referrals" as any,
    args: [address ?? (zeroAddress as `0x${string}`)],
    query: { enabled: readsEnabled && registryAddress !== zeroAddress },
  });

  const referralsCountLabel = useMemo(() => {
    if (!tokenMode) return "—";
    if (referralsCountErr) return "—";
    if (referralsCountMaybe === undefined || referralsCountMaybe === null) return "—";
    try {
      return String((referralsCountMaybe as any)?.toString?.() ?? referralsCountMaybe);
    } catch {
      return "—";
    }
  }, [tokenMode, referralsCountMaybe, referralsCountErr]);

  // ===== PFP resolve + ownership enforcement =====
  const [pfpStatus, setPfpStatus] = useState<string>("");
  const [pfpErr, setPfpErr] = useState<string>("");
  const [pfpImage, setPfpImage] = useState<string>("");

  const [pfpDraftChainId, setPfpDraftChainId] = useState<number>(TOKEN_CHAIN_IDS[0]);
  const [pfpDraftContract, setPfpDraftContract] = useState<string>("");
  const [pfpDraftTokenId, setPfpDraftTokenId] = useState<string>("");

  // Load cached image immediately (no chain dependency)
  useEffect(() => {
    if (!ready) return;
    const cached = profile.pfp?.image || "";
    setPfpImage(cached);
  }, [ready, profile.pfp?.image]);

  // Resolve/verify whenever pfp selection changes
  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    setPfpErr("");
    setPfpStatus("");

    const p = profile.pfp;
if (!p) {
  setPfpImage("");
  return;
}
const pfp = p; // ✅ snapshot for TS + correctness

async function run(pfp: NonNullable<StoredProfile["pfp"]>) {
  const pc = publicClientForChain(pfp.chainId);
  // ... use pfp.contract, pfp.tokenId everywhere
}

void run(pfp);


    async function run() {
      try {
        if (!address) {
          setPfpErr("Connect wallet to verify ownership.");
          return;
        }

        const pc = publicClientForChain(p.chainId);
        if (!pc) {
          setPfpErr("Unsupported NFT chain.");
          return;
        }

        setPfpStatus("Verifying ownership…");

        // 1) Verify ownership (ERC-721)
        const owner = (await pc.readContract({
          address: p.contract,
          abi: ERC721_ABI_MIN,
          functionName: "ownerOf",
          args: [BigInt(p.tokenId)],
        })) as `0x${string}`;

        if (owner.toLowerCase() !== address.toLowerCase()) {
          setPfpStatus("");
          setPfpErr("You don’t own this NFT. Please import an NFT owned by your connected wallet.");
          // Keep cached image off
          setPfpImage("");
          // Also clear cached image in storage (keep selection if you want, but it will never show)
          const next: StoredProfile = {
            ...profile,
            pfp: { ...p, image: undefined },
          };
          if (!cancelled) saveProfile(next);
          return;
        }

        // 2) Resolve tokenURI -> metadata -> image
        setPfpStatus("Loading NFT metadata…");

        const tokenUri = (await pc.readContract({
          address: p.contract,
          abi: ERC721_ABI_MIN,
          functionName: "tokenURI",
          args: [BigInt(p.tokenId)],
        })) as string;

        const resolvedTokenUri = normalizeUri(tokenUri);
        if (!resolvedTokenUri) {
          setPfpStatus("");
          setPfpErr("tokenURI() returned empty.");
          return;
        }

        const metaRes = await fetch(resolvedTokenUri, { cache: "no-store" });
        if (!metaRes.ok) {
          setPfpStatus("");
          setPfpErr(`Failed to fetch metadata. (HTTP ${metaRes.status})`);
          return;
        }

        const meta = (await metaRes.json()) as any;
        const img = normalizeUri(String(meta?.image || meta?.image_url || ""));
        if (!img) {
          setPfpStatus("");
          setPfpErr("Metadata has no image field.");
          return;
        }

        if (cancelled) return;

        setPfpImage(img);
        setPfpStatus("");

        // Cache image locally so it shows on any chain + in TopNav
        const next: StoredProfile = {
          ...profile,
          pfp: { ...p, image: img },
        };
        saveProfile(next);
      } catch (e: any) {
        if (cancelled) return;
        setPfpStatus("");
        setPfpErr(e?.shortMessage || e?.message || "Failed to load NFT.");
        setPfpImage("");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, profile.pfp?.chainId, profile.pfp?.contract, profile.pfp?.tokenId, address]);

  const pfpFallback = "/profile/default.png";
  const pfpSrc = pfpImage || pfpFallback;

  // Username UI
  const username = profile.username?.trim() ? profile.username.trim() : "Player";
  const usernameSlug = useMemo(() => {
    const base = username
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const suffix = String((gamesLen as any)?.toString?.() ?? "0");
    return base ? `${base}-${suffix}` : `player-${suffix}`;
  }, [username, gamesLen]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-5 md:p-6">
          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4">
              <div className="relative">
                <div className="h-16 w-16 overflow-hidden rounded-2xl ring-1 ring-neutral-800 bg-neutral-950">
                  <img
                    src={pfpSrc}
                    alt="Profile"
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
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
                  <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] font-semibold text-neutral-300">
                    {usernameSlug}
                  </span>

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
                    onClick={async () => {
                      if (!proofIdHash) return;
                      await copyText(proofIdHash);
                    }}
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-900"
                    disabled={!proofIdHash}
                    title={!proofIdHash ? "Connect wallet to generate" : "Copy Proof Game ID Hash"}
                  >
                    COPY PROOF HASH
                  </button>
                </div>
              </div>
            </div>

            {/* Network toggle */}
            <div className="w-full md:w-[320px]">
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
                          active
                            ? "border-emerald-500/30 bg-emerald-500/10"
                            : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900",
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
                  <div className="mt-2 text-[11px] text-amber-200">
                    Switch wallet network to match the selected chain.
                  </div>
                ) : null}
                {!ready ? (
                  <div className="mt-2 text-[11px] text-neutral-600">Initializing…</div>
                ) : !isConnected ? (
                  <div className="mt-2 text-[11px] text-neutral-600">
                    Connect wallet to load on-chain stats.
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Stat cards */}
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">IP Balance</div>
              <div className="mt-1 text-2xl font-extrabold">33</div>
              <div className="mt-1 text-[11px] text-neutral-600">Platform points (placeholder)</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Total Games</div>
              <div className="mt-1 text-2xl font-extrabold">
                {tokenMode ? String((gamesLen as any)?.toString?.() ?? "—") : "—"}
              </div>
              <div className="mt-1 text-[11px] text-neutral-600">On-chain (vault)</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Referrals</div>
              <div className="mt-1 text-2xl font-extrabold">{referralsCountLabel}</div>
              <div className="mt-1 text-[11px] text-neutral-600">If registry supports counting</div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-[12px] text-neutral-500">Total Claimed (referrals)</div>
              <div className="mt-1 text-2xl font-extrabold">
                {tokenMode ? `${totalClaimedReferralsLabel} DTC` : "—"}
              </div>
              <div className="mt-1 text-[11px] text-neutral-600">From ReferralRegistry</div>
            </div>
          </div>

          {/* Proof hash */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Proof Game ID Hash</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Used for support + fairness verification flows (placeholder until wired to your game hash).
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (!proofIdHash) return;
                  await copyText(proofIdHash);
                }}
                disabled={!proofIdHash}
                className={[
                  "rounded-xl border px-4 py-2 text-xs font-extrabold",
                  proofIdHash
                    ? "border-neutral-800 bg-neutral-900 text-neutral-100 hover:bg-neutral-800/60"
                    : "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-500",
                ].join(" ")}
              >
                COPY
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 font-mono text-[12px] text-neutral-200">
              {proofIdHash ? `${proofIdHash.slice(0, 14)}…${proofIdHash.slice(-14)}` : "—"}
            </div>
          </div>

          {/* Owed + PFP info */}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm font-semibold text-neutral-100">Claimable (vault owed)</div>
              <div className="mt-2 text-2xl font-extrabold">{tokenMode ? `${owedDtcLabel} DTC` : "—"}</div>
              <div className="mt-1 text-[12px] text-neutral-500">
                This is vault “owed” (separate from weekly referral claims).
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm font-semibold text-neutral-100">Profile picture</div>
              <div className="mt-1 text-[12px] text-neutral-500">
                Import an NFT you own (ERC-721) by contract + tokenId (Linea/Base). Stored locally on this device.
              </div>

              {profile.pfp ? (
                <div className="mt-3 text-[12px] text-neutral-300">
                  <div>
                    Chain:{" "}
                    <span className="text-neutral-100">
                      {CHAIN_LIST.find((c) => c.chainId === profile.pfp!.chainId)?.name ?? String(profile.pfp!.chainId)}
                    </span>
                  </div>
                  <div className="mt-1">
                    NFT:{" "}
                    <span className="font-mono text-neutral-100">
                      {profile.pfp!.contract}:{profile.pfp!.tokenId}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...profile };
                      delete next.pfp;
                      saveProfile(next);
                      setPfpImage("");
                      setPfpErr("");
                      setPfpStatus("");
                    }}
                    className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-extrabold text-neutral-100 hover:bg-neutral-800/60"
                  >
                    REMOVE PFP
                  </button>
                </div>
              ) : (
                <div className="mt-3 text-[12px] text-neutral-400">No NFT selected.</div>
              )}
            </div>
          </div>

          {/* History placeholder */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Game history</div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Last 20 games (recommended: index events with a backend or subgraph for fast UI).
                </div>
              </div>
              <span className="text-[11px] text-neutral-600">
                Tip: Stake-like history usually comes from an indexed DB, not direct RPC scans.
              </span>
            </div>

            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[12px] text-neutral-400">
              Not wired yet (needs event indexer/subgraph). UI shell is ready.
            </div>
          </div>
        </div>
      </section>

      {/* Edit Username Modal */}
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
              <div className="mt-2 text-[11px] text-neutral-500">Stored locally (private). Nothing public.</div>
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

      {/* Edit PFP Modal */}
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
              This PFP is <b>private</b>: stored only on your device, shown only to you (Profile + TopNav).
              <div className="mt-1 text-[11px] text-neutral-500">
                Ownership is verified on-chain via <span className="font-mono">ownerOf(tokenId)</span>.
              </div>
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
                <div className="mt-2 text-[11px] text-neutral-500">
                  Image will still load even if you switch chains (we fetch from the NFT’s chain).
                </div>
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

                <div className="mt-2 text-[11px] text-neutral-500">
                  Saved locally under your wallet address.
                </div>
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
                    pfp: {
                      chainId: pfpDraftChainId,
                      contract: c,
                      tokenId: pfpDraftTokenId,
                      image: undefined, // will be filled after verified + resolved
                    },
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

            {pfpErr ? (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
                {pfpErr}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
