"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { mainnet, linea, base, arbitrum, optimism } from "wagmi/chains";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RelayKitProvider, SwapWidget } from "@relayprotocol/relay-kit-ui";
import { MAINNET_RELAY_API, convertViemChainToRelayChain } from "@relayprotocol/relay-sdk";

const queryClient = new QueryClient();

const LINEA_CHAIN_ID = 59144;
const NATIVE = "0x0000000000000000000000000000000000000000";
const DTC = "0xEb1fD1dBB8aDDA4fa2b5A5C4bcE34F6F20d125D2";

const ETH_LOGO =
  "https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains/ethereum/info/logo.png";
const DTC_LOGO = "https://cdn.jsdelivr.net/gh/DonaldToad/dtc-assets@main/dtc-32.svg";

type RelayCurrency = {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  vmType?: string;
  logoURI?: string;
  metadata?: {
    logoURI?: string;
    verified?: boolean;
    isNative?: boolean;
  };
};

function withLogo(c: RelayCurrency, logoURI: string, extra?: Partial<RelayCurrency>): RelayCurrency {
  return {
    ...c,
    ...(extra ?? {}),
    logoURI,
    metadata: {
      ...(c.metadata ?? {}),
      ...(extra?.metadata ?? {}),
      logoURI,
    },
  };
}

export default function RelaySwapClient() {
  const { isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();

  const relayChains = useMemo(() => {
    return [
      convertViemChainToRelayChain(mainnet),
      convertViemChainToRelayChain(linea),
      convertViemChainToRelayChain(base),
      convertViemChainToRelayChain(arbitrum),
      convertViemChainToRelayChain(optimism),
    ];
  }, []);

  // Defaults: ETH(Linea) -> DTC(Linea)
  const [fromToken, setFromToken] = useState<RelayCurrency>(() =>
    withLogo(
      {
        chainId: LINEA_CHAIN_ID,
        address: NATIVE,
        decimals: 18,
        name: "Ether",
        symbol: "ETH",
        metadata: { isNative: true },
      },
      ETH_LOGO
    )
  );

  const [toToken, setToToken] = useState<RelayCurrency>(() =>
    withLogo(
      {
        chainId: LINEA_CHAIN_ID,
        address: DTC,
        decimals: 18,
        name: "Donald Toad Coin",
        symbol: "DTC",
      },
      DTC_LOGO
    )
  );

  // ✅ Fix for: "Current chain id X does not match expected chain id Y"
  // Whenever user changes FROM chain, switch wallet to that chain (best-effort).
  useEffect(() => {
    if (!isConnected) return;
    const expected = fromToken?.chainId;
    if (!expected) return;
    if (!chainId) return;
    if (chainId === expected) return;

    (async () => {
      try {
        await switchChainAsync({ chainId: expected });
      } catch (e) {
        // Non-fatal: widget will surface the mismatch if user refuses switching
        console.warn("Wallet refused chain switch:", e);
      }
    })();
  }, [isConnected, chainId, fromToken?.chainId, switchChainAsync]);

  const onConnectWallet = useCallback(() => {
    if (isConnected) return;
    const first = connectors?.[0];
    if (first) connect({ connector: first });
  }, [isConnected, connectors, connect]);

  return (
    <div className="w-full max-w-[440px] rounded-3xl border border-neutral-800 bg-neutral-950 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
      {/* Readable quick % chips */}
      <style jsx>{`
        .relayWrap {
          color-scheme: dark;
        }
        .relayWrap :global(button) {
          color-scheme: dark;
        }
        .relayWrap :global(button) :global(*) {
          text-shadow: none;
        }
        .relayWrap :global(button[aria-label*="%"]),
        .relayWrap :global(button[title*="%"]) {
          color: #0a0a0a !important;
          background: rgba(255, 255, 255, 0.92) !important;
          border: 1px solid rgba(0, 0, 0, 0.12) !important;
        }
      `}</style>

      <QueryClientProvider client={queryClient}>
        <RelayKitProvider
          options={{
            appName: "Lilypad Leap",
            themeScheme: "dark",
            chains: relayChains,
            baseApiUrl: MAINNET_RELAY_API,

            // Helps Relay analytics + removes “auto-generated source” warnings
            source: {
              name: "Lilypad Leap",
              url: "https://lilypad.donaldtoad.com",
            } as any,
          }}
        >
          <div className="relayWrap">
            <SwapWidget
              supportedWalletVMs={["evm"]}
              onConnectWallet={onConnectWallet}
              fromToken={fromToken as any}
              setFromToken={setFromToken as any}
              toToken={toToken as any}
              setToToken={setToToken as any}
              disableInputAutoFocus
              onRouteError={(e: any) => console.error("Relay route error:", e)}
              onSwapError={(e: any) => console.error("Relay swap error:", e)}
            />
          </div>
        </RelayKitProvider>
      </QueryClientProvider>

      <div className="mt-3 text-[11px] text-neutral-500 break-all">Default DTC (Linea): {DTC}</div>
    </div>
  );
}
