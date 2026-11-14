import type { NextConfig } from "next";

// Content-Security-Policy. 'unsafe-inline' for scripts is required because Next.js emits inline
// bootstrap/hydration scripts and we do not use per-request nonces (that would force dynamic rendering).
// Fonts come from next/font (self-hosted at build time), so no external font origin is needed.
// Everything else is closed: no third-party origins, no framing, no plugins.
const csp = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // e2e builds into its own directory so it never collides with a running dev server / other build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* config options here */
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
