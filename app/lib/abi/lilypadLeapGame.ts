// app/lib/abi/lilypadLeapGame.ts
export const LILYPAD_LEAP_GAME_ABI = [
  // views
  {
    type: "function",
    name: "MAX_HOPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "DEADLINE_SECONDS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MIN_BET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_BET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "openGameOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "games",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "player", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "createdAt", type: "uint40" },
      { name: "deadline", type: "uint40" },
      { name: "mode", type: "uint8" },
      { name: "userCommit", type: "bytes32" },
      { name: "randAnchor", type: "bytes32" },
      { name: "settled", type: "bool" },
      { name: "cashoutHop", type: "uint8" },
      { name: "payout", type: "uint128" },
    ],
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

  // writes
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
    name: "expire",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "bytes32" }],
    outputs: [],
  },

  // events
  {
    type: "event",
    name: "GameCreated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "bytes32" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "amountReceived", type: "uint256" },
      { indexed: false, name: "mode", type: "uint8" },
      { indexed: false, name: "userCommit", type: "bytes32" },
      { indexed: false, name: "randAnchor", type: "bytes32" },
      { indexed: false, name: "createdAt", type: "uint256" },
      { indexed: false, name: "deadline", type: "uint256" },
      { indexed: false, name: "maxPayoutReserved", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "GameSettled",
    anonymous: false,
    inputs: [
      { indexed: true, name: "gameId", type: "bytes32" },
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "won", type: "bool" },
      { indexed: false, name: "cashoutHop", type: "uint8" },
      { indexed: false, name: "payout", type: "uint256" },
      { indexed: false, name: "userCommitHash", type: "bytes32" },
      { indexed: false, name: "randAnchor", type: "bytes32" },
    ],
  },
] as const;
