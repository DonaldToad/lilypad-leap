// app/lib/wagmi.ts
import { createConfig, http } from "wagmi";
import { linea, base } from "wagmi/chains";
import { fallback } from "viem";

const BASE_RPCS = [
  "https://base.publicnode.com",
  "https://rpc.ankr.com/base",
  "https://1rpc.io/base",
];

const LINEA_RPCS = [
  "https://rpc.linea.build",
  "https://linea.publicnode.com",
  "https://1rpc.io/linea",
];

export const wagmiConfig = createConfig({
  chains: [linea, base],
  transports: {
    [base.id]: fallback(
      BASE_RPCS.map((url) =>
        http(url, {
          timeout: 12_000,
          retryCount: 0,
        })
      ),
      {
        rank: true,
      }
    ),

    [linea.id]: fallback(
      LINEA_RPCS.map((url) =>
        http(url, {
          timeout: 12_000,
          retryCount: 0,
        })
      ),
      {
        rank: true,
      }
    ),
  },
});
