import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:5181",
    viewport: { width: 390, height: 844 },
    channel: process.env.PW_CHANNEL || undefined,
  },
  webServer: {
    command: "npm run dev -- --port 5181 --strictPort",
    url: "http://127.0.0.1:5181",
    reuseExistingServer: false,
  },
  reporter: "list",
});
