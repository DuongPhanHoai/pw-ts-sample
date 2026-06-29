import { defineConfig } from "@playwright/test";
import { getEnv, getEnvConfig } from "./tests/config/env";

const env = getEnv();
const envCfg = getEnvConfig();

// Surface the active environment at startup so it's obvious in every test run.
// Playwright re-imports this config in every worker process, so guard with an
// env var to print the banner exactly once per invocation.
if (!process.env.__PW_BANNER_PRINTED) {
  // eslint-disable-next-line no-console
  console.log(
    `\n[playwright] TEST_ENV=${env} | ${envCfg.label} | baseURL=${envCfg.baseURL}\n`,
  );
  process.env.__PW_BANNER_PRINTED = "1";
}

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  retries: 1,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "reports/junit-results.xml" }],
    ["json", { outputFile: "reports/results.json" }],
  ],
  use: {
    headless: true,
    baseURL: envCfg.baseURL,
    screenshot: "only-on-failure",
    // Traces bloat CI artifacts and can hang upload-artifact; keep locally only.
    trace: process.env.CI ? "off" : "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // { name: "firefox", use: { browserName: "firefox" } },
    // { name: "webkit", use: { browserName: "webkit" } },
  ],
});
