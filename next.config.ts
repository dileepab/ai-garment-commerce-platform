import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Generated marketing images are multi-MB base64 strings; raise the default 1 MB cap.
      bodySizeLimit: '8mb',
    },
  },
};

export default nextConfig;
