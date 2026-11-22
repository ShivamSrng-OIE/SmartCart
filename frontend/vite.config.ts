/// <reference types="vitest/config" />
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BACKEND = "http://localhost:8000";

// Shopify's Shop MCP endpoint lives at the root path of mcp.shop.com. The browser calls
// /shop-mcp on our own origin; the dev/preview server forwards it, so there is no CORS
// and no browser-only headers (Origin, cookies) reach Shopify.
const shopMcp: ProxyOptions = {
  target: "https://mcp.shop.com",
  changeOrigin: true,
  secure: true,
  rewrite: () => "/",
  configure: (proxy) => {
    proxy.on("proxyReq", (req) => {
      req.removeHeader("origin");
      req.removeHeader("referer");
      req.removeHeader("cookie");
    });
  },
};

const proxy: Record<string, ProxyOptions> = {
  "/api": { target: BACKEND, changeOrigin: true },
  "/media": { target: BACKEND, changeOrigin: true },
  "/health": { target: BACKEND, changeOrigin: true },
  "/shop-mcp": shopMcp,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  // allowedHosts: lets a Cloudflare quick tunnel (https://*.trycloudflare.com) reach the preview server.
  preview: { port: 4173, proxy, allowedHosts: [".trycloudflare.com"] },
  // The 3D viewer (<model-viewer>, ~1 MB) is its own chunk, fetched only when someone opens a 3D model.
  build: { chunkSizeWarningLimit: 1100 },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
