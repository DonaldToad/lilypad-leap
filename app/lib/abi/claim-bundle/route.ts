// app/api/claim-bundle/route.ts
import { NextResponse } from "next/server";
import { isAddress, isHex } from "viem";

type ClaimBundle = {
  chainId: number;
  user: `0x${string}`;
  epochId: string; // uint256 as decimal string
  amount: string; // uint256 as decimal string (token units, e.g. DTC 18 decimals)
  generatedLoss: string; // uint256 as decimal string
  proof: `0x${string}`[]; // bytes32[]
  tokenSymbol?: string; // optional (for UI)
  tokenDecimals?: number; // optional (for UI)
};

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * TODO: Implement this with your storage.
 *
 * Recommended keys:
 *  - by chainId + epochId + user
 *  - OR by chainId + user returning latest unclaimed epoch bundle
 *
 * Return:
 *  - ClaimBundle if claimable
 *  - null if no claimable rewards for this user/chain
 */
async function loadBundleFromStore(_chainId: number, _user: `0x${string}`): Promise<ClaimBundle | null> {
  // Example placeholder: no rewards
  return null;

  // Example if you store JSON somewhere:
  // const url = `${process.env.CLAIM_BUNDLES_BASE_URL}/${_chainId}/${_user}.json`;
  // const r = await fetch(url, { cache: "no-store" });
  // if (r.status === 404) return null;
  // if (!r.ok) throw new Error(`Store fetch failed (${r.status})`);
  // return (await r.json()) as ClaimBundle;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const chainIdStr = searchParams.get("chainId") ?? "";
    const userStr = searchParams.get("user") ?? "";

    const chainId = Number(chainIdStr);
    if (!Number.isFinite(chainId) || chainId <= 0) return bad("Invalid chainId.");

    if (!isAddress(userStr)) return bad("Invalid user address.");
    const user = userStr as `0x${string}`;

    const bundle = await loadBundleFromStore(chainId, user);

    // Validate bundle shape if present (protect UI)
    if (bundle) {
      if (bundle.chainId !== chainId) return bad("Bundle chainId mismatch.", 500);
      if (bundle.user.toLowerCase() !== user.toLowerCase()) return bad("Bundle user mismatch.", 500);
      if (!bundle.epochId || !bundle.amount || !bundle.generatedLoss) return bad("Bundle missing fields.", 500);
      if (!Array.isArray(bundle.proof)) return bad("Bundle proof invalid.", 500);
      for (const p of bundle.proof) {
        if (!isHex(p) || p.length !== 66) return bad("Bundle proof contains invalid bytes32.", 500);
      }
    }

    return NextResponse.json({ ok: true, bundle }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unexpected error." },
      { status: 500 }
    );
  }
}
