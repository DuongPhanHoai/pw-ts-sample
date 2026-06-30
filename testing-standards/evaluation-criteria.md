# UI Testing Evaluation Criteria

## Functional Criteria
- All critical user flows must pass (login success, add-to-cart, checkout happy path).
- Expected login failures (`locked_out_user`, `invalid_user`) are intentional — not regressions.
- Non-critical flows may fail with documented justification.

## Classification Rules
- If only selectors changed, behavior same → `locators-broken`.
- If many tests time out with the same root cause (same file/line, same `waiting for locator(...)` in callLog, or triage grouped them as duplicates) → `locators-broken`, even when errorSummary says "Test timeout exceeded" — not `timing-flaky`.
- If timeout happens on one stuck action/locator while earlier steps in the flow succeeded → `locators-broken` (bad selector), not slow app.
- If network behavior changed (status codes, payloads, site down) → `backend-issue`.
- If expectations (text, flow) changed intentionally → `business-logic-change`.
- If failures are intermittent and timeout-related with no shared stuck locator → `timing-flaky`.
- If wrong user/product/customer row for active `TEST_ENV` → `test-data-issue`.

## Expected AI Output
- Markdown summary report → `reports/ai-analysis.md`.
- Structured JSON fix plan → `reports/ai-fix-plan.json`.

## Severity Hints
| Pattern | Category | Typical action |
|---------|----------|----------------|
| `locator` / `not visible` / `strict mode` | locators-broken | fix page object |
| `Test timeout` + `waiting for locator` / same locator across many tests | locators-broken | fix page object |
| `Timeout` intermittent, no stuck locator | timing-flaky | improve wait |
| `net::ERR` / HTTP 5xx | backend-issue | no auto-heal |
| Assertion on visible text / flow | business-logic-change | human review |
| Missing test data / wrong env | test-data-issue | fix data files |
