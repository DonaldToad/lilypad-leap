// app/lib/addresses.ts
export const DTC_BY_CHAIN: Record<number, `0x${string}`> = {
  // Linea
  59144: "0xEb1fD1dBB8aDDA4fa2b5A5C4bcE34F6F20d125D2",
  // Base
  8453: "0xFbA669C72b588439B29F050b93500D8b645F9354",
};

export const LILYPAD_VAULT_BY_CHAIN: Record<number, `0x${string}`> = {
  // Linea (v1.3.0)
  59144: "0xB40D9148d47fBA0EF74b44942f260C980C4A373a",
  // Base (v1.3.0)
  8453: "0x9565b8616196Ee08388fF1E3Fa80B6b4a45d064f",
};

export const REF_REGISTRY_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0x0dffbA58A30a44A40fCB17743681f4B1a6508c8D", // Linea
  8453: "0x3FCE6A5C85B6f30Cb5FeEdCc19DC9420EE8B48be",  // Base
};

export const WEEKLY_REWARDS_DISTRIBUTOR_BY_CHAIN: Record<number, `0x${string}`> = {
  59144: "0xa2DDB9eC60c436859d8aD688Dac3c2845673f10C", // Linea
  8453: "0x4ae0A91feD2233c607cA58CFd186540ae1c8eBfb",  // Base
};
