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
