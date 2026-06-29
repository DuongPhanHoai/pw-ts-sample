# UI Playwright Test Standards

## General Principles
- Tests must be deterministic and independent.
- Prefer page object model (POM) for selectors and actions.
- Keep specs thin; put locators and actions in `tests/pages/`.
- Use env-aware data from `tests/data/` — do not hard-code credentials in specs.

## Selector Guidelines
- Prefer `getByRole`, `getByTestId`, or stable data attributes where possible.
- Avoid brittle selectors (deep CSS hierarchy, index-based nth-child).
- When a selector breaks, fix the **page object** first, not every spec.

## SauceDemo Conventions
- Login flows use `LoginPage`; inventory uses `InventoryPage`; checkout uses `CheckoutPage`.
- Failed login cases must assert `expectedError` from the active env's `users.ts`.
- `TEST_ENV=dev` is the fast smoke matrix; `test` is full regression.

## Flakiness Rules
- Repeated timeouts or intermittent failures → category: `timing-flaky`.
- When in doubt, suggest improving waits or assertions before changing business expectations.

## Reporting
- Each test failure must be classified into a category (see `evaluation-criteria.md`).
- Each category maps to an auto-heal policy in `auto-heal-policy.json`.
