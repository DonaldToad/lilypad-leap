// lib/erc20.ts
import { readContract, writeContract, waitForTransactionReceipt } from "@wagmi/core";
import type { Config } from "wagmi";
import { maxUint256, parseUnits } from "viem";

const ERC20_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
  ], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ], outputs: [{ name: "", type: "bool" }] },
] as const;

export type ApprovalPolicy =
  | { kind: "unlimited" }
  | { kind: "limited"; capDtc: number }; // cap in whole DTC units

export async function getAllowance(args: {
  wagmiConfig: Config;
  token: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
}): Promise<bigint> {
  const { wagmiConfig, token, owner, spender } = args;
  return (await readContract(wagmiConfig, {
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
}

export async function approve(args: {
  wagmiConfig: Config;
  token: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
}): Promise<`0x${string}`> {
  const { wagmiConfig, token, spender, amount } = args;
  const hash = await writeContract(wagmiConfig, {
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

export async function ensureAllowance(args: {
  wagmiConfig: Config;
  token: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  neededDtc: number; // whole DTC units
  decimals?: number; // default 18
  policy: ApprovalPolicy;
}): Promise<{ didApprove: boolean; approveTx?: `0x${string}` }> {
  const { wagmiConfig, token, owner, spender, neededDtc, policy } = args;
  const decimals = args.decimals ?? 18;

  const needed = parseUnits(String(neededDtc), decimals);
  const allowance = await getAllowance({ wagmiConfig, token, owner, spender });

  if (allowance >= needed) return { didApprove: false };

  const approveAmount =
    policy.kind === "unlimited"
      ? maxUint256
      : parseUnits(String(Math.max(1, Math.trunc(policy.capDtc))), decimals);

  const tx = await approve({ wagmiConfig, token, spender, amount: approveAmount });
  return { didApprove: true, approveTx: tx };
}
