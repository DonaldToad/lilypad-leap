// app/lib/addresses.ts

/**
 * ✅ ONLY ALLOWED ADDRESSES (latest config)
 * Keep this file as the single source of truth for chain-specific contracts.
 */

export const DTC_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xEb1fD1dBB8aDDA4fa2b5A5C4bcE34F6F20d125D2", // Linea
  8453: "0xFbA669C72b588439B29F050b93500D8b645F9354", // Base
};

export const TOAD_ARCADE_VAULT_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xF4Bf262565e0Cc891857DF08Fe55de5316d0Db45", // Linea
  8453: "0x2C853B5a06A1F6C3A0aF4c1627993150c6585eb3", // Base
};

// LilypadLeapGameV2 (createGame / cashOut live here)
export const LILYPAD_GAME_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0x5Eb6920Af0163e749274619E8076666885Bf0B57", // Linea
  8453: "0x05df07E37B8dF836549B28AA3195FD54D57DD845", // Base
};

// ReferralRegistryV2 (bind + epoch accounting)
export const REF_REGISTRY_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xAbD4c0dF150025a1982FC8236e5880EcC9156BeE", // Linea
  8453: "0x994a28Bb8d84AacB691bA8773e81dAFC1acEb39B", // Base
};

// Backwards-compatible alias used by some pages
export const LILYPAD_VAULT_BY_CHAIN = TOAD_ARCADE_VAULT_BY_CHAIN;
