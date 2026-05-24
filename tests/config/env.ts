/**
 * Environment resolution.
 *
 * Pick the active environment by setting `TEST_ENV` to one of: dev, test, stg, prd.
 * Defaults to `test`. Unknown values throw at startup so typos fail loudly.
 *
 * Examples:
 *   TEST_ENV=dev  npx playwright test                   # bash / zsh
 *   $env:TEST_ENV="stg"; npx playwright test            # PowerShell
 *   set TEST_ENV=prd && npx playwright test             # cmd.exe
 */

export type Env = "dev" | "test" | "stg" | "prd";

const VALID_ENVS: readonly Env[] = ["dev", "test", "stg", "prd"];
const DEFAULT_ENV: Env = "test";

export function getEnv(): Env {
  const raw = (process.env.TEST_ENV ?? "").toLowerCase().trim();
  if (!raw) return DEFAULT_ENV;
  if ((VALID_ENVS as readonly string[]).includes(raw)) return raw as Env;
  throw new Error(
    `Unknown TEST_ENV "${process.env.TEST_ENV}". Expected one of: ${VALID_ENVS.join(", ")}.`,
  );
}

export type EnvConfig = {
  baseURL: string;
  /** Free-form description shown at startup for operator clarity. */
  label: string;
};

/**
 * Per-environment runtime configuration. All four envs point at saucedemo today
 * because that's the only real target — in a real project you'd point each row
 * at the matching environment URL.
 */
export const envConfig: Record<Env, EnvConfig> = {
  dev: {
    baseURL: "https://www.saucedemo.com",
    label: "Development (smoke set)",
  },
  test: {
    baseURL: "https://www.saucedemo.com",
    label: "Test (full matrix)",
  },
  stg: {
    baseURL: "https://www.saucedemo.com",
    label: "Staging (pre-prod subset)",
  },
  prd: {
    baseURL: "https://www.saucedemo.com",
    label: "Production (canary only)",
  },
};

export function getEnvConfig(): EnvConfig {
  return envConfig[getEnv()];
}
