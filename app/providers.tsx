"use client";

import React, { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WagmiProvider } from "wagmi";
import { http, createConfig } from "@wagmi/core";
import { mainnet, linea, base, arbitrum, optimism } from "wagmi/chains";

import { RelayKitProvider } from "@relayprotocol/relay-kit-ui";
import { MAINNET_RELAY_API, convertViemChainToRelayChain } from "@relayprotocol/relay-sdk";

// module-singleton QueryClient
const queryClient = new QueryClient();

export default function Providers({ children }: { children: React.ReactNode }) {
  const wagmiConfig = useMemo(() => {
    return createConfig({
      chains: [mainnet, linea, base, arbitrum, optimism],
      transports: {
        [mainnet.id]: http(),
        [linea.id]: http(),
        [base.id]: http(),
        [arbitrum.id]: http(),
        [optimism.id]: http(),
      },
    });
  }, []);

  const relayChains = useMemo(() => {
    return [
      convertViemChainToRelayChain(mainnet),
      convertViemChainToRelayChain(linea),
      convertViemChainToRelayChain(base),
      convertViemChainToRelayChain(arbitrum),
      convertViemChainToRelayChain(optimism),
    ];
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RelayKitProvider
          options={{
            appName: "Lilypad Leap",
            chains: relayChains,
            baseApiUrl: MAINNET_RELAY_API,
            themeScheme: "dark",
          }}
        >
          {children}
        </RelayKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
