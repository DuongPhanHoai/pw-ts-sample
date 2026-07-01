# pw-ts-sample

A sample **Playwright + TypeScript** end-to-end suite for [SauceDemo](https://www.saucedemo.com) (Page Object Model + data-driven tests), with an optional **local LLM pipeline**: analyze failures, generate a fix plan, apply patches, and open a **pull request** from CI.

> **Quick start (local):** `npm run pipeline:local` → open `reports/ai-test-report.md`  
> **Full docs:** **[docs/README.md](docs/README.md)** — index of all guides

---

## What this repo does

| Layer | Description |
|-------|-------------|
| **Tests** | Login, inventory, cart/checkout (data-driven), smoke, API mock |
| **Analyze** | LM Studio triage + fix plan → `reports/ai-fix-plan.json` |
| **Apply** | LLM rewrites allowed test files → `reports/auto-fix-audit.json` |
| **CI (optional)** | Self-hosted GitHub Actions: test → analyze → apply → re-run → **PR** into your branch |

**Design:** post-failure only, policy-governed auto-heal, human review via PR. See **[docs/AI-POST-AUTO-HEAL.md](docs/AI-POST-AUTO-HEAL.md)**.

---

## Documentation (where to look)

| You want… | Read |
|-----------|------|
| **Project overview & install** | **This README** |
| **Run on laptop (no GitHub)** | [docs/LOCAL-RUN.md](docs/LOCAL-RUN.md) |
| **CI on self-hosted runner + PR** | [docs/SELF-HOSTED-RUNNER.md](docs/SELF-HOSTED-RUNNER.md) |
| **Analyze / apply design** | [docs/AI-POST-AUTO-HEAL.md](docs/AI-POST-AUTO-HEAL.md) |
| **AI test eval & fixtures** | [ai-test/docs/Strategy.md](ai-test/docs/Strategy.md), [ai-test/inputs/](ai-test/inputs/) |
| **Doc index & pipeline summary** | [docs/README.md](docs/README.md) |

**Use README as the front door.** Keep deep setup, troubleshooting, and design in `docs/` so the root stays scannable.

---

## File map

```
pw-ts-sample/
├── .github/
│   └── workflows/
│       ├── playwright.yml          # disabled (on: []) — cloud smoke kept for reference
│       └── playwright-ai-ci.yml    # active: self-hosted tests + AI + auto PR
├── .env.example                    # LMSTUDIO_* settings, AUTO_FIX_TESTS, TEST_ENV
├── package.json                    # npm scripts and devDependencies
├── package-lock.json
├── playwright.config.ts            # testDir, retries, workers, reporters → reports/
├── quicknote.md                    # quick setup notes
├── storageState.json               # saved auth state (optional reuse)
├── playwright-report/              # generated HTML report (gitignored)
├── reports/                        # JSON/JUnit + AI outputs (gitignored)
├── testing-standards/              # markdown + auto-heal-policy.json
├── ai-test/
│   ├── docs/                       # evaluation strategy + ideas
│   │   ├── Strategy.md
│   │   └── ideas.md
│   └── inputs/                     # reusable failure fixtures (<case-label>/)
├── docs/
│   ├── README.md                   # documentation index
│   ├── LOCAL-RUN.md                # run tests + AI on your laptop
│   ├── AI-POST-AUTO-HEAL.md        # analyze + apply design reference
│   └── SELF-HOSTED-RUNNER.md       # GitHub self-hosted CI + PR
├── scripts/
│   ├── analyze_results.ts
│   ├── apply_ai_fixes.ts
│   ├── create-ai-fix-pr.ps1        # branch + PR (includes plan in body)
│   ├── run-local-pipeline.ps1
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
│   ├── ai-fix-plan.json            # structured fix plan (when failed)
│   └── auto-fix-audit.json         # what apply wrote (when auto-heal runs)
└── .github/workflows/
    ├── playwright.yml              # disabled
    └── playwright-ai-ci.yml        # self-hosted + AI + PR
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

**Playwright CI with Local AI** (`playwright-ai-ci.yml`) on a Windows self-hosted runner:

1. Tests → analyze → apply (`AUTO_FIX_TESTS=true` in workflow)
2. Re-run failed tests
3. Push branch `ai-fix/run-<runId>` and open a **PR into the branch that triggered the run**
4. PR description includes **AI fix plan** (root cause, proposed change, hints)

**Manual run:** Actions → **Playwright CI with Local AI** → **Run workflow** → pick branch + `TEST_ENV`.

**Runner:** `C:\actions-runner\` — start `.\run.cmd` from the folder that contains it (see self-hosted doc).

Local reports without GitHub:

```powershell
cd D:\Testing\pw-ts-sample
npm run pipeline:local
# → reports/ai-test-report.md
```

Local PR (after apply with `AUTO_FIX_TESTS=true`):

```powershell
npm run create-ai-fix-pr   # needs GH_TOKEN or gh auth
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

| Workflow | Status | Runner |
|----------|--------|--------|
| **`playwright-ai-ci.yml`** | **Active** | Self-hosted Windows (`[self-hosted, Windows, X64]`) |
| **`playwright.yml`** | **Disabled** (`on: []`) | Was GitHub-hosted ubuntu smoke |

**Active pipeline steps:** checkout → test → `analyze:results` → `apply:ai-fixes` → re-run failed → **create PR** → upload report artifacts.

**Repo settings often needed:**

- **Allow GitHub Actions to create and approve pull requests** (or secret `GH_TOKEN` PAT)
- If **startup failure** on `actions/*`: allow GitHub-owned actions, or use a workflow variant with plain `git`/`npm` steps (see [SELF-HOSTED-RUNNER.md](docs/SELF-HOSTED-RUNNER.md))

Details: **[docs/SELF-HOSTED-RUNNER.md](docs/SELF-HOSTED-RUNNER.md)**

---

## Test site credentials

The suite uses the public demo credentials baked into `LoginPage.ts`:

- **Username:** `standard_user`
- **Password:** `secret_sauce`

Other users supported by saucedemo (e.g. `locked_out_user`, `problem_user`, `performance_glitch_user`) can be wired into `LoginPage.ts` if you want to expand coverage.
