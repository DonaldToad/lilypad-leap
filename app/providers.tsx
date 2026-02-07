"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { mainnet, linea, base, arbitrum, optimism } from "wagmi/chains";

import { RelayKitProvider } from "@relayprotocol/relay-kit-ui";
import { MAINNET_RELAY_API, convertViemChainToRelayChain } from "@relayprotocol/relay-sdk";

// Singletons (must not recreate every render)
const queryClient = new QueryClient();

const wagmiConfig = createConfig({
  chains: [mainnet, linea, base, arbitrum, optimism],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [linea.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
  },
});

const relayChains = [
  convertViemChainToRelayChain(mainnet),
  convertViemChainToRelayChain(linea),
  convertViemChainToRelayChain(base),
  convertViemChainToRelayChain(arbitrum),
  convertViemChainToRelayChain(optimism),
];

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
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
      </QueryClientProvider>
    </WagmiProvider>
  );
}
