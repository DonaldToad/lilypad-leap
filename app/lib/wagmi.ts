// app/lib/wagmi.ts
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { base, linea } from "wagmi/chains";

// Safe defaults (so the app works even if env vars are missing)
const LINEA_RPC = process.env.NEXT_PUBLIC_LINEA_RPC_URL || "https://rpc.linea.build";
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://1rpc.io/base";

export const wagmiConfig = createConfig({
  chains: [linea, base],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [linea.id]: http(LINEA_RPC),
    [base.id]: http(BASE_RPC),
  },
});
