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
  retries: 1, // retry failing tests once
  workers: 4, // run up to 4 tests in parallel (tune to your machine/CI)
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    headless: true,
    baseURL: envCfg.baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure", // collects traces on failures
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // { name: "firefox", use: { browserName: "firefox" } },
    // { name: "webkit", use: { browserName: "webkit" } },
  ],
});
