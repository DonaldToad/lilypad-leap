// app/lib/abi/referralRegistry.ts
export const REFERRAL_REGISTRY_ABI = [
  // reads
  {
    type: "function",
    name: "referrerOf",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "referrer", type: "address" }],
  },
  {
    type: "function",
    name: "publicCodeOf",
    stateMutability: "view",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [{ name: "code", type: "bytes32" }],
  },
  {
    type: "function",
    name: "computePublicCode",
    stateMutability: "pure",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [{ name: "code", type: "bytes32" }],
  },
  {
    type: "function",
    name: "referrer_total_generated_loss",
    stateMutability: "view",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [{ name: "loss", type: "uint256" }],
  },
  {
    type: "function",
    name: "referrer_total_rewards",
    stateMutability: "view",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [{ name: "rewards", type: "uint256" }],
  },

  // writes
  {
    type: "function",
    name: "registerMyPublicCode",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "code", type: "bytes32" }],
  },
  {
    type: "function",
    name: "bindWithCode",
    stateMutability: "nonpayable",
    inputs: [{ name: "code", type: "bytes32" }],
    outputs: [],
  },
] as const;
