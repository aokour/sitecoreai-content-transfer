import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.sitecorecloud.io",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
