import type { NextConfig } from "next";

/**
 * @coinbase/cdp-sdk (pulled in by RainbowKit -> wagmi connectors -> Base account) dynamically imports
 * the optional @x402/* payment packages. Dripp never uses x402 payments, so they resolve to a stub
 * (lib/x402-stub.ts) instead of pulling a Solana SDK into the build.
 */
const stubbed = [
  "@x402/core/client",
  "@x402/core/server",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/exact/v1/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact/client",
  "@x402/svm/exact/v1/client",
  "@x402/svm/upto/client",
  "@x402/fetch",
];

/**
 * Demo mode (sample data, no backend) is on when NEXT_PUBLIC_DEMO=1, and by default for Vercel builds
 * that have no NEXT_PUBLIC_API_URL yet, so a preview deployment renders without the backend.
 */
const demo = process.env.NEXT_PUBLIC_DEMO ?? (process.env.VERCEL && !process.env.NEXT_PUBLIC_API_URL ? "1" : "0");

const config: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_DEMO: demo },
  // @dripp/shared is TypeScript source in the workspace
  transpilePackages: ["@dripp/shared"],
  turbopack: {
    resolveAlias: Object.fromEntries(stubbed.map((m) => [m, "./lib/x402-stub.ts"])),
  },
};

export default config;
