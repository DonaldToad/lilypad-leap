// app/lib/abi/weeklyRewardsDistributor.ts
export const WEEKLY_REWARDS_DISTRIBUTOR_ABI = [
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
  },
  {
    type: "function",
    name: "epochs",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "" }],
    outputs: [
      { type: "bytes32", name: "merkleRoot" },
      { type: "uint256", name: "start" },
      { type: "uint256", name: "end" },
      { type: "uint256", name: "totalFunded" },
    ],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "" }, { type: "address", name: "" }],
    outputs: [{ type: "bool", name: "" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "epochId" },
      { type: "uint256", name: "amount" },
      { type: "uint256", name: "generatedLoss" },
      { type: "bytes32[]", name: "proof" },
    ],
    outputs: [],
  },
] as const;
