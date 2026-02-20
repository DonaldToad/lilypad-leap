// app/lib/abi/referralRegistry.ts
export const REFERRAL_REGISTRY_ABI = [
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "address", name: "initialOwner", type: "address" },
      { internalType: "uint16", name: "_defaultRefBps", type: "uint16" },
      { internalType: "uint16", name: "_partnerRefBps", type: "uint16" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  { inputs: [{ internalType: "address", name: "owner", type: "address" }], name: "OwnableInvalidOwner", type: "error" },
  { inputs: [{ internalType: "address", name: "account", type: "address" }], name: "OwnableUnauthorizedAccount", type: "error" },
  { inputs: [], name: "ReentrancyGuardReentrantCall", type: "error" },
  { inputs: [{ internalType: "address", name: "token", type: "address" }], name: "SafeERC20FailedOperation", type: "error" },

  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: true, internalType: "bytes32", name: "code", type: "bytes32" },
    ],
    name: "Bound",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "uint16", name: "defaultBps", type: "uint16" },
      { indexed: false, internalType: "uint16", name: "partnerBps", type: "uint16" },
    ],
    name: "BpsSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "epochId", type: "uint256" },
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "Claimed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "epochId", type: "uint256" },
      { indexed: false, internalType: "int256", name: "profit", type: "int256" },
      { indexed: false, internalType: "uint256", name: "totalBase", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "rewardsTotal", type: "uint256" },
    ],
    name: "EpochFinalized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "game", type: "address" },
      { indexed: false, internalType: "bool", name: "allowed", type: "bool" },
    ],
    name: "GameSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "previousOwner", type: "address" },
      { indexed: true, internalType: "address", name: "newOwner", type: "address" },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "bool", name: "isPartner", type: "bool" },
    ],
    name: "PartnerSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "bytes32", name: "code", type: "bytes32" },
    ],
    name: "PublicCodeRegistered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "epochId", type: "uint256" },
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "address", name: "referrer", type: "address" },
      { indexed: false, internalType: "uint256", name: "amountReceived", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "payout", type: "uint256" },
      { indexed: false, internalType: "int256", name: "houseDelta", type: "int256" },
      { indexed: false, internalType: "uint256", name: "baseAdded", type: "uint256" },
    ],
    name: "TotalsUpdated",
    type: "event",
  },

  { inputs: [], name: "BPS_DENOM", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "TOKEN", outputs: [{ internalType: "contract IERC20", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "WEEK", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },

  { inputs: [{ internalType: "address", name: "player", type: "address" }, { internalType: "bytes32", name: "code", type: "bytes32" }], name: "bindFor", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "bytes32", name: "code", type: "bytes32" }], name: "bindWithCode", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "uint256", name: "epochId", type: "uint256" }], name: "claim", outputs: [], stateMutability: "nonpayable", type: "function" },

  { inputs: [{ internalType: "uint256", name: "", type: "uint256" }, { internalType: "address", name: "", type: "address" }], name: "claimed", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], name: "codeToReferrer", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "referrer", type: "address" }], name: "computePublicCode", outputs: [{ internalType: "bytes32", name: "code", type: "bytes32" }], stateMutability: "pure", type: "function" },

  { inputs: [], name: "currentEpoch", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "defaultRefBps", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },

  { inputs: [{ internalType: "uint256", name: "", type: "uint256" }, { internalType: "address", name: "", type: "address" }], name: "epochBaseOf", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "epochs",
    outputs: [
      { internalType: "bool", name: "finalized", type: "bool" },
      { internalType: "int256", name: "profit", type: "int256" },
      { internalType: "uint256", name: "totalBase", type: "uint256" },
      { internalType: "uint256", name: "rewardsTotal", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [{ internalType: "uint256", name: "epochId", type: "uint256" }], name: "finalizeEpoch", outputs: [], stateMutability: "nonpayable", type: "function" },

  { inputs: [{ internalType: "address", name: "referrer", type: "address" }], name: "getRefBps", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "isGame", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "isPartnerReferrer", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },

  { inputs: [{ internalType: "address", name: "player", type: "address" }, { internalType: "uint256", name: "amountReceived", type: "uint256" }, { internalType: "uint256", name: "payout", type: "uint256" }, { internalType: "uint256", name: "", type: "uint256" }], name: "onGameSettled", outputs: [], stateMutability: "nonpayable", type: "function" },

  { inputs: [], name: "owner", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "partnerRefBps", outputs: [{ internalType: "uint16", name: "", type: "uint16" }], stateMutability: "view", type: "function" },

  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "publicCodeOf", outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "referrerOf", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },

  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "referrer_total_generated_loss", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "referrer_total_rewards_base", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },

  { inputs: [], name: "registerMyPublicCode", outputs: [{ internalType: "bytes32", name: "code", type: "bytes32" }], stateMutability: "nonpayable", type: "function" },

  { inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "uint16", name: "_defaultRefBps", type: "uint16" }, { internalType: "uint16", name: "_partnerRefBps", type: "uint16" }], name: "setBps", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "game", type: "address" }, { internalType: "bool", name: "allowed", type: "bool" }], name: "setGame", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "referrer", type: "address" }, { internalType: "bool", name: "v", type: "bool" }], name: "setPartner", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "newOwner", type: "address" }], name: "transferOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;
