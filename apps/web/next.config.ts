import type { NextConfig } from "next";
import path from "node:path";

const backendInternalUrl = (process.env.BACKEND_INTERNAL_URL?.trim() || "http://localhost:3001").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendInternalUrl}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${backendInternalUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
