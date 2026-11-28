"use strict";

const fs = require("node:fs");
const { defineConfig } = require("@playwright/test");
const { chromium } = require("@playwright/test");

const E2E_PORT = Number(process.env.E2E_PORT || 45173);

function resolveBrowserChannel() {
  if (process.env.PLAYWRIGHT_CHANNEL) return process.env.PLAYWRIGHT_CHANNEL;
  if (process.env.CI) return undefined;
  const executablePath = chromium.executablePath();
  if (executablePath && fs.existsSync(executablePath)) {
    return process.platform === "win32" ? "chromium" : undefined;
  }
  if (
    process.platform === "win32" &&
    fs.existsSync("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")
  ) {
    return "msedge";
  }
  return undefined;
}

const channel = resolveBrowserChannel();

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    headless: true,
    acceptDownloads: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: channel ? { browserName: "chromium", channel } : { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "node tests/e2e/static-server.js",
    env: {
      ...process.env,
      PORT: String(E2E_PORT),
    },
    url: `http://127.0.0.1:${E2E_PORT}/`,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
