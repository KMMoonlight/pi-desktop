import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/runtime/**",
        "**/.local/**",
        "**/test-results/**",
      ],
    },
    proxy: {
      "/api": `http://127.0.0.1:${process.env.PI_DESKTOP_PORT ?? 4319}`,
    },
  },
  clearScreen: false,
});
