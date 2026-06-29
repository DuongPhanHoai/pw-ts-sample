# UI Testing Evaluation Criteria

## Functional Criteria
- All critical user flows must pass (login success, add-to-cart, checkout happy path).
- Expected login failures (`locked_out_user`, `invalid_user`) are intentional — not regressions.
- Non-critical flows may fail with documented justification.

## Classification Rules
- If only selectors changed, behavior same → `locators-broken`.
- If network behavior changed (status codes, payloads, site down) → `backend-issue`.
- If expectations (text, flow) changed intentionally → `business-logic-change`.
- If failures are intermittent and timeout-related → `timing-flaky`.
- If wrong user/product/customer row for active `TEST_ENV` → `test-data-issue`.

## Expected AI Output
- Markdown summary report → `reports/ai-analysis.md`.
- Structured JSON fix plan → `reports/ai-fix-plan.json`.

## Severity Hints
| Pattern | Category | Typical action |
|---------|----------|----------------|
| `locator` / `not visible` / `strict mode` | locators-broken | fix page object |
| `Timeout` / `waiting for` | timing-flaky | improve wait |
| `net::ERR` / HTTP 5xx | backend-issue | no auto-heal |
| Assertion on visible text / flow | business-logic-change | human review |
| Missing test data / wrong env | test-data-issue | fix data files |
