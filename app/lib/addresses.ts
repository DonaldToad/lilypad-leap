// app/lib/addresses.ts

export const DTC_BY_CHAIN: Record<number, `0x${string}`> = {
  // Linea
  59144: "0xEb1fD1dBB8aDDA4fa2b5A5C4bcE34F6F20d125D2",
  // Base
  8453: "0xFbA669C72b588439B29F050b93500D8b645F9354",
};

// Vault (if used elsewhere)
export const TOAD_ARCADE_VAULT_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xF4Bf262565e0Cc891857DF08Fe55de5316d0Db45",
  8453: "0x2C853B5a06A1F6C3A0aF4c1627993150c6585eb3",
};

// ✅ GAME addresses (Play page uses these for createGame/cashOut)
export const LILYPAD_GAME_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0x71dF04f70b87994C4cB2a69A735D821169fE7148",
  8453: "0x7f4EAc0BDBeF0b782ff57E6897112DB9D31E6AB3",
};

export const REF_REGISTRY_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0x0dffbA58A30a44A40fCB17743681f4B1a6508c8D",
  8453: "0x3FCE6A5C85B6f30Cb5FeEdCc19DC9420EE8B48be",
};

export const WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xa2DDB9eC60c436859d8aD688Dac3c2845673f10C",
  8453: "0x4ae0A91feD2233c607cA58CFd186540ae1c8eBfb",
};
