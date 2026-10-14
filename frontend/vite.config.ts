import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Forwards RPC calls to the Go orchestrator, stripping the /rpc
      // prefix so the upstream sees the bare /mcpstudio.v1.Orchestrator/...
      // procedure path the Go mux registered. This keeps every RPC call
      // same-origin in dev, so CORS never needs to be solved on the Go side.
      "/rpc": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc/, ""),
      },
    },
  },
});
