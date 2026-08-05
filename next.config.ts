import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TikTok Account OAuth requires the registered callback path to end in `/`.
  // Preserve that exact URI instead of issuing Next.js's automatic slash redirect.
  skipTrailingSlashRedirect: true,
  experimental: {
    serverActions: {
      // Generated marketing images are multi-MB base64 strings; raise the default 1 MB cap.
      bodySizeLimit: '8mb',
    },
  },
};

export default nextConfig;
