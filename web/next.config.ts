import type { NextConfig } from "next";

// Until the marketing site exists, the apex and www hosts hand off to the app
// host. Temporary (307) on purpose: browsers must not cache the hop once
// www.mostfundable.com becomes its own site.
const APP_HOST = "app.mostfundable.com";
const HANDOFF_HOSTS = ["mostfundable.com", "www.mostfundable.com"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return HANDOFF_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${APP_HOST}/:path*`,
      permanent: false,
    }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/api/referrals/resolve/:token",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
