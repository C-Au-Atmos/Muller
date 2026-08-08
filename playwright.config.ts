import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: process.env.CI ? 90_000 : 30_000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm.cmd run dev",
    env: {
      ...process.env,
      VITE_MULLER_TEST_INITIAL_PATH: "D:\\Muller",
    },
    url: "http://127.0.0.1:1420",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
