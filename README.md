# pw-ts-sample

A sample Playwright + TypeScript end-to-end test suite that exercises [https://www.saucedemo.com](https://www.saucedemo.com) using the Page Object Model (POM).

The suite covers login, inventory browsing, add-to-cart, the full checkout flow, and a simple API-mocking example. It runs on Chromium by default and uploads an HTML report from CI.

---

## File map

```
pw-ts-sample/
├── .github/
│   └── workflows/
│       └── playwright.yml          # CI: install, run tests, upload HTML report
├── .gitignore
├── package.json                    # npm scripts and devDependencies
├── package-lock.json
├── playwright.config.ts            # testDir, retries, workers, reporter, baseURL
├── quicknote.md                    # quick setup notes
├── storageState.json               # saved auth state (optional reuse)
├── playwright-report/              # generated HTML report (gitignored)
│   └── index.html
├── test-results/                   # generated run artifacts (gitignored)
│   └── .last-run.json
└── tests/
    ├── cart-and-checkout.spec.ts   # add-to-cart + full checkout flow
    ├── inventory.spec.ts           # inventory listing & add-to-cart assertions
    ├── login.spec.ts               # login + reuse auth state
    ├── smoke.spec.ts               # smoke check of the login page
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

- **`LoginPage.ts`** — `goto()`, `loginAsStandardUser()`, `assertError()`, `smokePage()`
- **`InventoryPage.ts`** — `addBackpackToCart()`, `openCart()`, `expectItemsInPage()`, `expectItemsInCart()`, `smokePage()`
- **`CheckoutPage.ts`** — `checkoutFullFlow()`

Specs import these classes and call high-level methods rather than driving raw selectors, which keeps tests readable and locator changes contained to a single file.

---

## Continuous integration

`.github/workflows/playwright.yml` runs on every `push` and `pull_request`:

1. Checkout
2. Setup Node 20
3. `npm ci`
4. `npx playwright install --with-deps`
5. `npx playwright test`
6. Upload the `playwright-report/` directory as an artifact (retained 7 days)

---

## Test site credentials

The suite uses the public demo credentials baked into `LoginPage.ts`:

- **Username:** `standard_user`
- **Password:** `secret_sauce`

Other users supported by saucedemo (e.g. `locked_out_user`, `problem_user`, `performance_glitch_user`) can be wired into `LoginPage.ts` if you want to expand coverage.
