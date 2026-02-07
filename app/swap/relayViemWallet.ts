import type { WalletClient, Account, Hex } from "viem";
import { createWalletClient, custom, hexToBigInt } from "viem";
import type { Address } from "viem";

// Minimal “AdaptedWallet”-compatible shape used by relay-kit-ui/sdk
export type RelayAdaptedWallet = {
  vmType: "evm";
  getChainId: () => Promise<number>;
  address: () => Promise<string>;
  transport: any;

  // signing / sending
  handleSignMessageStep: (stepItem: any) => Promise<string | undefined>;
  handleSendTransactionStep: (chainId: number, stepItem: any) => Promise<any>;

  // chain switching (fixes “current chain does not match expected”)
  switchChain: (chainId: number) => Promise<void>;
};

// Trimmed + formatted version of Relay’s own adaptViemWallet implementation
export function adaptViemWallet(wallet: WalletClient): RelayAdaptedWallet {
  return {
    vmType: "evm",

    getChainId: async () => {
      return wallet.getChainId();
    },

    transport: custom(wallet.transport),

    address: async () => {
      let addr = wallet.account?.address;
      if (!addr) {
        const addrs = await wallet.getAddresses();
        addr = addrs?.[0];
      }
      if (!addr) throw new Error("No wallet address available");
      return addr;
    },

    handleSignMessageStep: async (stepItem: any) => {
      const signData = stepItem?.data?.sign;
      if (!signData) return undefined;

      // eip191 message signing
      if (signData.signatureKind === "eip191") {
        const msg = signData.message as string;

        // if it looks like a 32-byte hash, sign raw bytes
        if (/^0x[0-9a-fA-F]{64}$/.test(msg)) {
          return wallet.signMessage({
            account: wallet.account as Account,
            message: { raw: msg as Hex },
          });
        }

        return wallet.signMessage({
          account: wallet.account as Account,
          message: msg,
        });
      }

      // eip712 typed data signing
      if (signData.signatureKind === "eip712") {
        return wallet.signTypedData({
          account: wallet.account as Account,
          domain: signData.domain as any,
          types: signData.types as any,
          primaryType: signData.primaryType,
          message: signData.value,
        } as any);
      }

      return undefined;
    },

    handleSendTransactionStep: async (chainId: number, stepItem: any) => {
      const stepData = stepItem?.data;
      if (!stepData?.to || stepData?.data == null) {
        throw new Error("Relay step missing transaction payload");
      }

      // We must send using a wallet client bound to the *current* chain
      const viemClient = createWalletClient({
        account: (wallet.account ?? stepData.from) as any,
        chain: wallet.chain as any, // wallet.chain tracks the connected chain in injected wallets
        transport: custom(wallet.transport, { retryCount: 10, retryDelay: 200 }),
      });

      // If Relay asks to send on chainId, wallet must be switched already
      const current = await wallet.getChainId();
      if (current !== chainId) {
        throw new Error(`Current chain id: ${current} does not match expected chain id: ${chainId}`);
      }

      return viemClient.sendTransaction({
        account: (wallet.account ?? stepData.from) as any,
        to: stepData.to as Address,
        data: stepData.data as Hex,
        value: hexToBigInt((stepData.value as any) || 0),
        ...(stepData.maxFeePerGas && { maxFeePerGas: hexToBigInt(stepData.maxFeePerGas as any) }),
        ...(stepData.maxPriorityFeePerGas && {
          maxPriorityFeePerGas: hexToBigInt(stepData.maxPriorityFeePerGas as any),
        }),
        ...(stepData.gas && { gas: hexToBigInt(stepData.gas as any) }),
      });
    },

    switchChain: async (targetChainId: number) => {
      // Prefer viem’s switchChain (works with injected wallets that support it)
      try {
        // @ts-ignore - walletClient has switchChain on injected connectors
        await wallet.switchChain?.({ id: targetChainId });
        return;
      } catch (_) {
        // fallback to EIP-1193 method
      }

      // EIP-1193 switch
      const hexId = "0x" + targetChainId.toString(16);
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexId }],
      } as any);
    },
  };
}
