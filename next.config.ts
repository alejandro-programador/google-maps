import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera .next/standalone con server.js y solo las dependencias necesarias (para VPS)
  output: "standalone",
};

export default nextConfig;
