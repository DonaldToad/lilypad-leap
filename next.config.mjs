// next.config.mjs
import path from "path";
import { fileURLToPath } from "url";

/** ESM-safe __dirname */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import("next").NextConfig} */
const nextConfig = {
  // ✅ This makes `next build` generate an `out/` directory (static export)
  output: "export",

  // ✅ Required for static export
  images: { unoptimized: true },

  // ✅ Optional but recommended for static hosting (avoids route edge-cases)
  trailingSlash: true,

  // ✅ Fixes your earlier "root inferred as C:\dev" issue if it ever comes back
  // (keeps Turbopack from walking up to C:\dev and looking for deps there)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
