import os from "node:os";
import type { NextConfig } from "next";

// In dev mode Next.js only serves its dev assets to localhost. Phones on the LAN open the app via
// this machine's IP, so those IPs (and its hostname) have to be allowed explicitly.
function lanOrigins(): string[] {
  const hosts = new Set<string>([os.hostname().toLowerCase(), `${os.hostname().toLowerCase()}.local`]);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) hosts.add(entry.address);
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  poweredByHeader: false,
  allowedDevOrigins: lanOrigins(),
  turbopack: {
    // Pin the project root; otherwise a stray package-lock.json higher up (e.g. in the user's
    // home folder) makes Next.js guess the wrong workspace root.
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
