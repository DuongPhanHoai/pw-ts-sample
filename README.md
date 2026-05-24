# pw-ts-sample

A sample Playwright + TypeScript end-to-end test suite that exercises [https://www.saucedemo.com](https://www.saucedemo.com) using the **Page Object Model (POM)** and **data-driven testing**.

The suite covers login, inventory browsing, add-to-cart, the full checkout flow, and a simple API-mocking example. Login, add-to-cart, and checkout specs are parameterized over typed data fixtures, so adding a new user, product, or customer profile is a one-line change. It runs on Chromium by default and uploads an HTML report from CI.

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
    ├── cart-and-checkout.spec.ts   # data-driven: products × customers
    ├── inventory.spec.ts           # data-driven: add-to-cart per product
    ├── login.spec.ts               # data-driven: success + failure users
    ├── smoke.spec.ts               # smoke check of the login page
    ├── data/                       # typed data fixtures (data-driven inputs)
    │   ├── customers.ts            # checkout customer profiles
    │   ├── products.ts             # inventory products + data-test slugs
    │   └── users.ts                # login users (positive + negative)
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

---

## Data-driven testing

Test inputs live in `tests/data/` as typed TypeScript arrays, and the specs `for`-loop over them so every row becomes its own Playwright `test(...)` block. This means each row shows up individually in the report, retries, traces, and `--grep`.

| File                       | Type        | Used by                                       |
| -------------------------- | ----------- | --------------------------------------------- |
| `tests/data/users.ts`      | `UserRow[]` | `login.spec.ts` — success + failure scenarios |
| `tests/data/products.ts`   | `ProductRow[]` | `inventory.spec.ts`, `cart-and-checkout.spec.ts` |
| `tests/data/customers.ts`  | `CustomerRow[]` | `cart-and-checkout.spec.ts`               |

### Pattern used in the specs

```ts
import { users } from "./data/users";

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

Just append to the array — no spec changes required:

```ts
// tests/data/users.ts
export const users: UserRow[] = [
  // ...existing rows...
  { username: "error_user", password: "secret_sauce", shouldLogin: true },
];
```

`cart-and-checkout.spec.ts` does a Cartesian product of `products × customers`, so be mindful of run count when growing those arrays (currently 6 × 3 = 18 cases).

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
