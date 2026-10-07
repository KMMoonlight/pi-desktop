import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:1540",
    viewport: { width: 1440, height: 940 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npx tsx tests/preview.ts",
      url: "http://127.0.0.1:4331/api/token",
      env: { PI_DESKTOP_PORT: "4331" },
      reuseExistingServer: false,
      timeout: 90000,
    },
    {
      command: "npx vite --host 127.0.0.1 --port 1540 --strictPort",
      url: "http://127.0.0.1:1540",
      env: { PI_DESKTOP_PORT: "4331" },
      reuseExistingServer: false,
      timeout: 90000,
    },
  ],
});
