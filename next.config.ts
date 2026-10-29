import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Reuse a visited page for 30s when navigating back to it instead of re-rendering on
    // the server. Server Actions still call revalidatePath, which clears it immediately.
    staleTimes: {
      dynamic: 30,
    },
    // Tree-shake icon imports so pages don't ship the whole lucide-react barrel.
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
