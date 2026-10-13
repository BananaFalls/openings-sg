import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      // Old hash routes from the single-file MVP (#kopi, #coffee, #business, #dashboard, #sector).
      { source: "/kopi", destination: "/about#kopi", permanent: false },
      { source: "/coffee", destination: "/about#kopi", permanent: false },
      { source: "/business", destination: "/about#business", permanent: false },
      { source: "/dashboard", destination: "/", permanent: false },
      { source: "/overview", destination: "/", permanent: false },
      { source: "/sector", destination: "/sectors", permanent: false },
      { source: "/roles", destination: "/sectors#roles", permanent: false },
      // No-JavaScript fallback for the sector picker on the hiring season page.
      {
        source: "/season",
        has: [{ type: "query", key: "sector", value: "(?<sector>[a-z0-9-]+)" }],
        destination: "/season/:sector",
        permanent: false,
      },
      {
        source: "/sectors",
        has: [{ type: "query", key: "sector", value: "(?<sector>[a-z0-9-]+)" }],
        destination: "/sectors/:sector",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
