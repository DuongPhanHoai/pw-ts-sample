# pw-ts-sample

A sample Playwright + TypeScript end-to-end test suite that exercises [https://www.saucedemo.com](https://www.saucedemo.com) using the **Page Object Model (POM)** and **data-driven testing**.

The suite covers login, inventory browsing, add-to-cart, the full checkout flow, and a simple API-mocking example. Login, add-to-cart, and checkout specs are parameterized over typed data fixtures, so adding a new user, product, or customer profile is a one-line change. It runs on Chromium by default and uploads an HTML report from CI.

> **Run locally (tests + AI report):** see **[docs/LOCAL-RUN.md](docs/LOCAL-RUN.md)**  
> Quick start: `npm run pipeline:local` → open `reports/ai-test-report.md`

---

## File map

```
pw-ts-sample/
├── .github/
│   └── workflows/
│       ├── playwright.yml          # CI: install, run tests, upload HTML report
│       └── playwright-ai-ci.yml    # self-hosted: tests + local AI analysis
├── .env.example                    # LMSTUDIO_* settings, AUTO_FIX_TESTS, TEST_ENV
├── package.json                    # npm scripts and devDependencies
├── package-lock.json
├── playwright.config.ts            # testDir, retries, workers, reporters → reports/
├── quicknote.md                    # quick setup notes
├── storageState.json               # saved auth state (optional reuse)
├── playwright-report/              # generated HTML report (gitignored)
├── reports/                        # JSON/JUnit + AI outputs (gitignored)
├── testing-standards/              # markdown + auto-heal-policy.json
├── docs/
│   ├── LOCAL-RUN.md                # ← run tests + AI report on your laptop
│   └── SELF-HOSTED-RUNNER.md       # GitHub self-hosted runner (optional CI)
├── scripts/                        # analyze_results, apply_ai_fixes, local pipeline
│   └── install-self-hosted-runner.ps1
└── tests/
    ├── cart-and-checkout.spec.ts   # data-driven: products × customers
    ├── inventory.spec.ts           # data-driven: add-to-cart per product
    ├── login.spec.ts               # data-driven: success + failure users
    ├── smoke.spec.ts               # smoke check of the login page
    ├── config/
    │   └── env.ts                  # TEST_ENV resolution + per-env baseURL
    ├── data/                       # typed data fixtures (per-env)
    │   ├── index.ts                # single env-aware resolver (users, products, customers)
    │   ├── types.ts                # shared row types (UserRow, ProductRow, …)
    │   ├── dev/                    # minimal smoke set for fast local loop
    │   │   ├── customers.ts
    │   │   ├── products.ts
    │   │   └── users.ts
    │   ├── test/                   # full coverage matrix (default)
    │   │   ├── customers.ts
    │   │   ├── products.ts
    │   │   └── users.ts
    │   ├── stg/                    # pre-prod subset (success path only)
    │   │   ├── customers.ts
    │   │   ├── products.ts
    │   │   └── users.ts
    │   └── prd/                    # production canary (single safe case)
    │       ├── customers.ts
    │       ├── products.ts
    │       └── users.ts
    ├── mocks/
    │   └── sample.mock.spec.ts     # page.route() API mocking example
    └── pages/                      # Page Object Model
        ├── CheckoutPage.ts
        ├── InventoryPage.ts
        └── LoginPage.ts
```

---

## Prerequisites

- **Node.js** 20+ (matches the CI workflow)
- **npm** 9+

On Windows PowerShell you may need to relax the execution policy once:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Installation

```bash
# 1. install dependencies
npm install

# 2. install Playwright's browser binaries (Chromium is enough for this project)
npx playwright install
```

---

## Running the tests

The npm scripts defined in `package.json`:

| Command                  | What it does                                          |
| ------------------------ | ----------------------------------------------------- |
| `npm test`               | Run all tests headlessly                              |
| `npm run test:headed`    | Run all tests with a visible browser window          |
| `npm run test:debug`     | Launch the Playwright Inspector for step-by-step debugging |
| `npm run show-report`    | Open the most recent HTML report                      |

### Useful ad-hoc commands

```bash
# run a single spec
npx playwright test tests/cart-and-checkout.spec.ts

# pick a project and run headed + debug
npx playwright test tests/cart-and-checkout.spec.ts --project=chromium --headed --debug

# run tests matching a title
npx playwright test -g "checkout"

# update the HTML report after a run
npx playwright show-report
```

---

## Configuration highlights

From `playwright.config.ts`:

- **baseURL:** `https://www.saucedemo.com`
- **testDir:** `tests`
- **timeout:** 30 s
- **retries:** 1
- **workers:** 4 (tune to your machine/CI)
- **reporter:** `list` + `html` (HTML report is not auto-opened)
- **screenshot:** `only-on-failure`
- **trace:** `retain-on-failure`
- **projects:** `chromium` (Firefox and WebKit are commented out — uncomment to enable)

---

## Page Object Model

All page interactions live under `tests/pages/`:

- **`LoginPage.ts`** — `goto()`, `loginAs(user, pass)`, `loginAsStandardUser()`, `expectInventoryLoaded()`, `assertError()`, `smokePage()`
- **`InventoryPage.ts`** — `addItemToCart(slug)`, `addBackpackToCart()`, `openCart()`, `expectItemsInPage()`, `expectItemsInCart()`, `smokePage()`
- **`CheckoutPage.ts`** — `checkoutFullFlow(customer)`

Specs import these classes and call high-level methods rather than driving raw selectors, which keeps tests readable and locator changes contained to a single file.

Debug locator: npx playwright codegen  https://sauce-demo.myshopify.com

**getByRole** button, link(\<a>), textbox, checkbox, ..., alert(toast message), dialog (Modal/Popup), status (loading), img
- name is Accessible Name (aria-label, alt, <label>)
- combine with name: checked (checkbox), disabled, expanded, level (for heading); Ex: page.getByRole('button',{name:'Send'}); page.getByRole('checkbox',{checked:true})
  await page.getByRole('row')
  .filter({ hasText: 'Product A' })
  .getByRole('button', { name: 'Delete' })
  .click();
- Note on alert(), confirm(), or prompt(): page.on('dialog', dialog => dialog.accept());
---

## Data-driven testing

Test inputs live in `tests/data/` as typed TypeScript arrays, and the specs `for`-loop over them so every row becomes its own Playwright `test(...)` block. This means each row shows up individually in the report, retries, traces, and `--grep`.

All three data dimensions are re-exported from a single env-aware entry point — [tests/data/index.ts](tests/data/index.ts) — so specs use one import line:

| Export                  | Type            | Used by                                         |
| ----------------------- | --------------- | ----------------------------------------------- |
| `users`                 | `UserRow[]`     | `login.spec.ts` — success + failure scenarios   |
| `products`              | `ProductRow[]`  | `inventory.spec.ts`, `cart-and-checkout.spec.ts`|
| `customers`             | `CustomerRow[]` | `cart-and-checkout.spec.ts`                     |

### Pattern used in the specs

```ts
import { users } from "./data";

for (const user of users) {
  test(`login: ${user.username}`, async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAs(user.username, user.password);
    if (user.shouldLogin) await login.expectInventoryLoaded();
    else await login.assertError(user.expectedError!);
  });
}
```

### Adding a new row

Just append to the active env's array — no spec changes required. Example for the default `test` env:

```ts
// tests/data/test/users.ts
export const users: UserRow[] = [
  // ...existing rows...
  { username: "error_user", password: "secret_sauce", shouldLogin: true },
];
```

`cart-and-checkout.spec.ts` does a Cartesian product of `products × customers`, so be mindful of run count when growing those arrays.

---

## Environments (dev / test / stg / prd)

Test data is isolated per environment. The active env is picked from the `TEST_ENV` variable and resolved in [tests/config/env.ts](tests/config/env.ts) — unknown values throw at startup so typos fail loudly.

| Env     | Default? | Users | Products | Customers | Intent                          |
| ------- | -------- | ----- | -------- | --------- | ------------------------------- |
| `dev`   |          | 2     | 1        | 1         | Fast local loop, smoke only     |
| `test`  | ✅       | 5     | 6        | 3         | Full matrix (default)           |
| `stg`   |          | 2     | 3        | 2         | Pre-prod subset, success path   |
| `prd`   |          | 1     | 1        | 1         | Production canary, safe-only    |

Each env owns its own `users.ts`, `products.ts`, and `customers.ts` under `tests/data/<env>/`. A single resolver at [tests/data/index.ts](tests/data/index.ts) re-exports the active env's data, so specs don't need to know which env is in play — they just `import { users, products, customers } from "./data"`.

Per-env `baseURL` lives in the same `tests/config/env.ts` (all four point at saucedemo today since it's the only available target — swap them out for real environment URLs in a real project).

### Selecting an environment

```bash
# bash / zsh
TEST_ENV=dev  npx playwright test
TEST_ENV=stg  npx playwright test tests/login.spec.ts

# PowerShell
$env:TEST_ENV="prd"; npx playwright test

# cmd.exe
set TEST_ENV=prd && npx playwright test
```

If `TEST_ENV` is unset, the suite runs against `test`. Every run prints the active env at startup (exactly once, regardless of worker count — guarded by `__PW_BANNER_PRINTED` in `playwright.config.ts`):

```
[playwright] TEST_ENV=stg | Staging (pre-prod subset) | baseURL=https://www.saucedemo.com
```

### Adding a new environment

1. Add the value to the `Env` union and `VALID_ENVS` array in `tests/config/env.ts`.
2. Add a row to `envConfig` with the right `baseURL`.
3. Create `tests/data/<new-env>/{users,products,customers}.ts`.
4. Add the env to the `byEnv` map in `tests/data/index.ts`.

TypeScript will fail compilation until all four spots are wired up — that's intentional, it keeps the env registry honest.

---

## Local AI-assisted pipeline (no Neo4j)

> **Full guide:** **[docs/LOCAL-RUN.md](docs/LOCAL-RUN.md)**

```powershell
cd D:\Testing\pw-ts-sample
copy .env.example .env
npm install
npx playwright install chromium

# LM Studio on, then:
npm run pipeline:local
start reports\ai-test-report.md
```

```text
pw-ts-sample/
├── tests/                          # Playwright specs + page objects
├── testing-standards/
│   ├── ui-playwright-standards.md
│   ├── evaluation-criteria.md
│   └── auto-heal-policy.json       # which categories may auto-heal
├── scripts/
│   ├── analyze_results.ts          # → reports/ai-analysis.md, ai-fix-plan.json
│   ├── apply_ai_fixes.ts           # controlled by AUTO_FIX_TESTS
│   └── run-local-pipeline.ps1
├── reports/                        # generated (gitignored)
│   ├── results.json
│   ├── junit-results.xml
│   ├── ai-test-report.md           # main AI report: pass/fail + tests to fix
│   ├── ai-test-report.json         # same data, machine-readable
│   ├── ai-analysis.md              # detailed failure analysis (when failed)
│   └── ai-fix-plan.json            # structured fix plan (when failed)
└── .github/workflows/
    ├── playwright.yml              # cloud smoke (ubuntu)
    └── playwright-ai-ci.yml        # self-hosted + local AI
```

### Environment variables

| Variable | Example | Purpose |
|----------|---------|---------|
| `LMSTUDIO_BASE_URL` | `http://192.168.1.166:1234/v1` | LM Studio OpenAI-compatible endpoint |
| `LMSTUDIO_MODEL` | `google/gemma-4-e4b` | Model id shown in LM Studio server tab |
| `LMSTUDIO_TIMEOUT_SECONDS` | `60` | Request timeout for AI analysis |
| `LMSTUDIO_API_KEY` | `lm-studio` | Placeholder key (LM Studio ignores it) |
| `TEST_ENV` | `dev` | Playwright data matrix |
| `AUTO_FIX_TESTS` | `false` | `false` \| `dry-run` \| `true` |

### Report outputs

| File | When | Content |
|------|------|---------|
| `reports/ai-test-report.md` | Always | **Main report** — PASS/FAIL, summary table, tests to fix, passed list |
| `reports/ai-test-report.json` | Always | Same data as JSON |
| `reports/ai-analysis.md` | Failures only | Detailed AI failure analysis |
| `reports/ai-fix-plan.json` | Failures only | Auto-heal fix plan |

```powershell
$env:TEST_ENV="dev"; npm test
npm run analyze:results
# Open reports/ai-test-report.md
```

### Setup

```powershell
copy .env.example .env
npm install
npx playwright install chromium
```

Ensure **LM Studio** is serving on the machine at `LMSTUDIO_BASE_URL` with model `google/gemma-4-e4b` loaded.

### Run locally

```powershell
# tests only
$env:TEST_ENV="dev"; npm test

# full pipeline: test → analyze → optional fix
npm run pipeline:local

# auto-heal modes
$env:AUTO_FIX_TESTS="false"     # analysis only (default)
$env:AUTO_FIX_TESTS="dry-run"  # print what would change
$env:AUTO_FIX_TESTS="true"      # apply fixes + re-run --last-failed
```

### CI on your laptop (self-hosted runner)

Full guide: **[docs/SELF-HOSTED-RUNNER.md](docs/SELF-HOSTED-RUNNER.md)**

**`.\run.cmd` = wait for jobs. It does not create reports until a workflow runs.**

Quick setup:

1. **Start runner** (leave terminal open):

   ```powershell
   cd C:\actions-runner\pw-ts-sample
   .\run.cmd
   ```

2. **Trigger the AI workflow** (runner alone is not enough):  
   **Actions** → **Playwright CI with Local AI** → **Run workflow**

3. **Download reports**: Actions → that run → **Artifacts** → `reports` → open `ai-test-report.md`

For reports in your repo folder without GitHub, run locally:

```powershell
cd D:\Testing\pw-ts-sample
npm run pipeline:local
# → D:\Testing\pw-ts-sample\reports\ai-test-report.md
```

### Auto-heal control

| Control | Purpose |
|---------|---------|
| `testing-standards/auto-heal-policy.json` | Which failure categories allow auto-heal |
| `AUTO_FIX_TESTS` | `false` \| `dry-run` \| `true` |

Categories with `autoHeal: true` by default: `locators-broken`, `timing-flaky`.  
App/backend/data issues are never auto-fixed.

---

## Continuous integration

`.github/workflows/playwright.yml` runs on every `push` and `pull_request` (GitHub-hosted):

1. Checkout
2. Setup Node 20
3. `npm ci`
4. `npx playwright install --with-deps`
5. `npx playwright test`
6. Upload the `playwright-report/` directory as an artifact (retained 7 days)

For **local LLM analysis**, use `playwright-ai-ci.yml` on a **self-hosted runner** — see **[docs/SELF-HOSTED-RUNNER.md](docs/SELF-HOSTED-RUNNER.md)**.

---

## Test site credentials

The suite uses the public demo credentials baked into `LoginPage.ts`:

- **Username:** `standard_user`
- **Password:** `secret_sauce`

Other users supported by saucedemo (e.g. `locked_out_user`, `problem_user`, `performance_glitch_user`) can be wired into `LoginPage.ts` if you want to expand coverage.
