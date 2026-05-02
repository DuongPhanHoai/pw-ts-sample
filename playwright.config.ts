import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  retries: 1, // retry failing tests once
  workers: 4, // run up to 4 tests in parallel (tune to your machine/CI)
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    headless: true,
    baseURL: "https://www.saucedemo.com",
    screenshot: "only-on-failure",
    trace: "retain-on-failure", // collects traces on failures
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // { name: "firefox", use: { browserName: "firefox" } },
    // { name: "webkit", use: { browserName: "webkit" } },
  ],
});
