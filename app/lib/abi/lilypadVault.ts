// app/lib/abi/lilypadVault.ts
export const LILYPAD_VAULT_ABI = [
  // -----------------------------
  // Events (receipt/log decoding)
  // -----------------------------
  {
    type: "event",
    name: "GameCreated",
    inputs: [
      { name: "gameId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amountReceived", type: "uint256", indexed: false },
      { name: "mode", type: "uint8", indexed: false }, // enum Mode
      { name: "userCommit", type: "bytes32", indexed: false },
      { name: "randAnchor", type: "bytes32", indexed: false },
      { name: "createdAt", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GameSettled",
    inputs: [
      { name: "gameId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "won", type: "bool", indexed: false },
      { name: "cashoutHop", type: "uint8", indexed: false },
      { name: "payout", type: "uint256", indexed: false },
      { name: "userCommitHash", type: "bytes32", indexed: false },
      { name: "randAnchor", type: "bytes32", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GameRefunded",
    inputs: [
      { name: "gameId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },

  // -----------------------------
  // Views
  // -----------------------------
  {
    type: "function",
    name: "owed",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserGamesLength",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserGamesSlice",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [{ name: "ids", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "games",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "bytes32" }],
    outputs: [
      { name: "player", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "createdAt", type: "uint40" },
      { name: "deadline", type: "uint40" },
      { name: "mode", type: "uint8" },
      { name: "userCommit", type: "bytes32" },
      { name: "randAnchor", type: "bytes32" },
      { name: "settled", type: "bool" },
      { name: "refunded", type: "bool" },
      { name: "cashoutHop", type: "uint8" },
      { name: "payout", type: "uint128" },
    ],
  },

  // -----------------------------
  // Core actions
  // -----------------------------
  {
    type: "function",
    name: "createGame",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "mode", type: "uint8" },
      { name: "userCommit", type: "bytes32" },
    ],
    outputs: [{ name: "gameId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "cashOut",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gameId", type: "bytes32" },
      { name: "userSecret", type: "bytes32" },
      { name: "cashoutHop", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;
