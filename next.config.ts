import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // FIX turbopack.root — Next 16.2+ exige cette config quand le projet est dans
  // un sous-dossier. On utilise process.cwd() (compatible ESM/Turbopack) au lieu
  // de __dirname qui ne marche pas en ESM.
  turbopack: {
    root: process.cwd(),
  },
  // Lock the image optimizer to only the logo CDNs actually used by the app.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "a.espncdn.com" },
      { protocol: "https", hostname: "media.api-sports.io" },
    ],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  // Remove the `X-Powered-By: Next.js` response header so attackers can't
  // fingerprint the framework + version to target known CVEs.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            // 2 years + preload — forces HTTPS for all subdomains.
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Frame-Options",
            // Defence in depth — CSP frame-ancestors is the modern equivalent
            // but older browsers still rely on this header.
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            // PWA needs no camera/mic/geo — deny everything by default.
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // `unsafe-inline` is required by Next.js inline runtime chunks
              // and our SW registration script. `unsafe-eval` is required in
              // dev (HMR) — keep it for dev, drop in prod via the env check below.
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
              "style-src 'self' 'unsafe-inline'",
              // Only allow images from self, data: URIs (favicons), and the two
              // logo CDNs actually used by the app: ESPN team logos (served by
              // the ESPN scoreboard API via a.espncdn.com) and API-Football
              // team logos (*.media.api-sports.io). Wildcard https: removed.
              "img-src 'self' data: https://a.espncdn.com https://*.media.api-sports.io",
              "font-src 'self' data:",
              // Restrict fetch/WebSocket to same-origin only — blocks exfil
              // to attacker-controlled endpoints. ESPN logos are loaded as
              // <img> tags (covered by img-src) so connect-src can be strict.
              "connect-src 'self'",
              // === CRITICAL FIX: was `frame-ancestors *` which allowed any
              // site to embed PronoBot in an iframe and run clickjacking /
              // steal data via postMessage. Now restricted to same-origin only.
              "frame-ancestors 'self'",
              "object-src 'none'",
              "worker-src 'self'",
              "manifest-src 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
