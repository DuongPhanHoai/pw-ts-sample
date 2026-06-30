# AI post-failure test repair

This document describes the **post-failure analysis and optional auto-heal** pipeline in `pw-ts-sample`: how Playwright test failures are captured, triaged with a local LLM, and optionally patched under explicit policy controls.

It is a **reference design** for “analyze after red, fix only when allowed” — not autonomous healing during the test run.

---

## Problem

When a Playwright suite fails at scale (especially data-driven matrices), engineers face the same issues repeatedly:

| Challenge | Example |
|-----------|---------|
| Duplicate failures | 18 checkout tests fail on one typo: `.carts_item` vs `.cart_item` |
| Thin error context | Playwright `error-context.md` a11y snapshot shows content but **not CSS classes** |
| Token cost | Sending full HTML/CSS + error context for every failure does not scale |
| Unsafe automation | Blind LLM edits to tests can mask real product bugs |

This pipeline separates **diagnosis** from **repair**, groups duplicate root causes, sends only the evidence the model asks for, and applies code changes only when policy allows.

---

## Design principles

1. **Post-failure only** — tests run normally; AI runs after `reports/results.json` exists.
2. **Evidence-based** — fixes should cite call log, page HTML/CSS attachments, or test source — not guesses.
3. **Two-step LLM** — triage on summaries first; fetch heavy detail only when needed.
4. **Policy-governed apply** — `apply:ai-fixes` respects category rules, confidence, path allowlists, and file caps.
5. **Human in the loop by default** — `AUTO_FIX_TESTS=false` until the team trusts the flow.
6. **Local-first LLM** — LM Studio (OpenAI-compatible API); no cloud requirement for the sample.

---

## End-to-end flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. PLAYWRIGHT RUN                                              │
│     npm test  →  reports/results.json                           │
│     On failure: screenshot, error-context, page-html, page-css  │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. ANALYZE (npm run analyze:results)                           │
│     Step 1 — Triage LLM: group duplicates, request detail fields│
│     Step 2 — Fix LLM per group: selective detail → fix plan     │
│     → reports/ai-triage.json, ai-fix-plan.json, ai-test-report  │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. APPLY (npm run apply:ai-fixes)  [optional]                  │
│     Filter by auto-heal-policy.json                             │
│     LLM rewrites allowed files  →  reports/auto-fix-audit.json  │
│     Re-run: npx playwright test --last-failed                   │
└─────────────────────────────────────────────────────────────────┘
```

One command for local dev:

```powershell
npm run pipeline:local
```

See also [LOCAL-RUN.md](LOCAL-RUN.md) for setup and troubleshooting.

---

## Phase 1 — Failure capture (Playwright)

### Standard Playwright artifacts

| Attachment | Purpose |
|------------|---------|
| `error-context` | A11y YAML snapshot + embedded test source |
| `screenshot` | Visual confirmation (not sent to LLM today) |
| `trace` | Local debug only (`retain-on-failure`; off in CI) |

### Custom attachments (`tests/fixtures.ts`)

On failure, the shared test fixture saves:

| Attachment | Source | Why |
|------------|--------|-----|
| `page-html` | `page.content()` | Rendered DOM with `class`, `id`, `data-test` |
| `page-css` | `document.styleSheets` | Live CSS rules (e.g. `.cart_item`) |

These land under `test-results/.../` and appear in `reports/results.json` attachment paths.

**Why not parse trace zip?** Trace parsing was removed in favour of direct HTML/CSS capture at failure time — simpler, works when `trace: off` in CI, and matches what the page actually rendered.

---

## Phase 2 — Two-step LLM analysis

Implemented in `scripts/analyze_results.ts` with helpers in:

- `scripts/lib/failure-triage.ts` — summaries, grouping, selective detail
- `scripts/lib/page-evidence.ts` — build `pageEvidence` from attachments
- `scripts/lib/failure-classifier.ts` — deterministic locator hints
- `scripts/lib/llm-batch.ts` — triage and fix-plan prompts

### Step 1 — Triage (one LLM call for all failures)

**Input:** compact **summary** per failed test:

- `testName`, `file`, `line`, `errorSummary`, `callLog`, `failureLocation`, `failingSelector`
- `pipelineHint` from the deterministic classifier (category, suggested fix when obvious)

**Not included yet:** `errorContextMd`, `pageEvidence`, full stack traces.

**Output:** `reports/ai-triage.json`

```json
{
  "groups": [{
    "groupId": "carts-item-typo",
    "representativeTestName": "cart-and-checkout.spec.ts > … > checkout \"…\" as Alex Nguyen",
    "memberTestNames": ["…all duplicate tests…"],
    "likelyCategory": "locators-broken",
    "triageSummary": "Wrong selector .carts_item — page uses .cart_item",
    "detailFieldsNeeded": ["pageEvidence", "errorContextMd"],
    "duplicateReason": "Same InventoryPage.ts:16 locator and call log"
  }],
  "notes": "All cart checkout rows share one page object typo."
}
```

**Fallback:** if the triage LLM fails, failures are grouped deterministically by signature (file + line + selector + error summary).

### Step 2 — Fix plan (one LLM call per group)

**Input:** triage group + **only** the detail fields requested in step 1:

| Detail field | Content |
|--------------|---------|
| `errorDetail` | Full Playwright error excerpt |
| `errorContextMd` | A11y snapshot + test source from `error-context.md` |
| `pageEvidence` | CSS classes, rules excerpt, DOM excerpt, `closestClassMatch` |
| `pageEvidenceCssOnly` | CSS subset |
| `pageEvidenceDomOnly` | DOM subset + class match |

**Output:** one fix plan entry for the **representative** test, expanded to every `memberTestName` in the group.

Reports:

| File | Contents |
|------|----------|
| `reports/ai-fix-plan.json` | Full plan + triage snapshot |
| `reports/ai-triage.json` | Step 1 groups only |
| `reports/ai-analysis.md` | Step 1 triage + step 2 fix sections |
| `reports/ai-test-report.md` | Human-readable report for QA |
| `reports/ai-token-estimate.json` | Token usage per LLM call |

### Deterministic layer

Before and after LLM calls, `failure-classifier.ts` can:

- Detect “waiting for locator('.carts_item')” patterns
- Compare against `pageEvidence.closestClassMatch` (e.g. `.carts_item` → `.cart_item`, distance 1)
- Boost confidence and override weak LLM categories for obvious locator typos

This reduces hallucinated “timing” diagnoses when the real issue is a selector typo.

---

## Phase 3 — Policy-governed apply

`scripts/apply_ai_fixes.ts` reads `reports/ai-fix-plan.json` and `testing-standards/auto-heal-policy.json`.

### Category policy (excerpt)

| Category | Auto-heal? | Allowed paths |
|----------|------------|---------------|
| `locators-broken` | Yes | `tests/pages`, `tests` |
| `timing-flaky` | Yes | `tests/pages`, `tests` |
| `backend-issue` | No | — |
| `business-logic-change` | No | — |
| `test-data-issue` | No | — |

### Gates before a file is modified

- `canAutoHeal === true` in fix plan
- Category `autoHeal: true` in policy
- `confidence >= minConfidence` (default **0.75**)
- File path in category `allowedPaths`
- At most **`maxFilesPerRun`** (default **3**) distinct files per run

### Apply modes (`AUTO_FIX_TESTS`)

| Value | Behaviour |
|-------|-----------|
| `false` | Analysis only (default) |
| `dry-run` | Log what would change; write audit entry |
| `true` | LLM returns full file content → write disk → audit |

Audit log: `reports/auto-fix-audit.json`

After apply, re-run failed tests:

```powershell
npx playwright test --last-failed
```

---

## Configuration reference

### LM Studio / analyze

| Variable | Default | Purpose |
|----------|---------|---------|
| `LMSTUDIO_BASE_URL` | `http://192.168.1.166:1234/v1` | OpenAI-compatible endpoint |
| `LMSTUDIO_MODEL` | `google/gemma-4-e4b` | Model id |
| `LMSTUDIO_TIMEOUT_SECONDS` | `60` | Per-request timeout |
| `LMSTUDIO_FAILURE_LIMIT` | — | Analyze only first N failures |
| `LMSTUDIO_LOG_PROMPTS` | — | Save prompts to `reports/llm-prompts/` |
| `LMSTUDIO_MAX_ERROR_CHARS` | `2000` | Truncate error fields in prompts |
| `LMSTUDIO_PAGE_EVIDENCE` | `filtered` | `filtered` \| `full` \| `off` |
| `LMSTUDIO_MAX_PAGE_EVIDENCE_CHARS` | `12000` | Cap CSS + DOM excerpt size |

Legacy batch settings (`LMSTUDIO_BATCH_SIZE`) remain in `.env.example` but the analyzer now uses **two-phase** grouping instead of per-test fix+analysis loops.

### Auto-heal

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTO_FIX_TESTS` | `false` | `false` \| `dry-run` \| `true` |

Policy file: `testing-standards/auto-heal-policy.json`  
Standards: `testing-standards/ui-playwright-standards.md`, `evaluation-criteria.md`

---

## Example: selector typo across a data-driven matrix

**Failure:** `locator('.carts_item')` → 0 elements; cart row visible in a11y snapshot.

**Step 1 triage** groups 18 checkout tests → one group → requests `pageEvidence`, `errorContextMd`.

**Step 2 detail** includes:

- CSS: `.cart_item { … }`
- DOM: `class="cart_item" data-test="inventory-item"`
- Classifier: `closestClassMatch: .carts_item → .cart_item`

**Fix plan:** replace `.carts_item` with `.cart_item` in `tests/pages/InventoryPage.ts:16`.

**Apply (if enabled):** one file change fixes all 18 tests on re-run.

---

## Safety and limitations

### What this is good for

- Locator / selector typos and minor POM drift
- Obvious wait/timing tweaks (when policy allows)
- Reducing duplicate LLM work across data-driven failures

### What it is not

- Not a substitute for product bug triage (`backend-issue`, `business-logic-change` stay manual)
- Not verified without re-running tests — always run `--last-failed` or full suite after apply
- Not multi-file refactors — capped at `maxFilesPerRun`
- Vision/screenshot analysis not wired in yet

### Known gaps / future work

- [ ] Structured patch hunks instead of full-file LLM rewrite on apply
- [ ] PR bot integration (post triage + fix plan as review comment)
- [ ] Eval suite: golden failures → expected fix plan JSON
- [ ] Optional screenshot + vision model for layout regressions
- [ ] CI analyze without trace (page-html/css attachments work in CI)

---

## Code map

```
scripts/
  analyze_results.ts       # Orchestrates two-phase analyze
  apply_ai_fixes.ts        # Policy-governed file apply
  lib/
    failure-triage.ts      # Step 1 summaries, grouping, selective detail
    page-evidence.ts       # page-html / page-css → pageEvidence
    failure-classifier.ts  # Deterministic locator classification
    llm-batch.ts           # Triage + fix-plan LLM prompts
    playwright-results.ts  # Load results.json + attachments
tests/
  fixtures.ts              # Attach page-html + page-css on failure
testing-standards/
  auto-heal-policy.json    # What categories may auto-heal
```

---

## Quick commands

```powershell
# Full pipeline (tests → analyze → optional apply)
npm run pipeline:local

# Analyze only (after tests)
npm run analyze:results

# Dry-run apply
$env:AUTO_FIX_TESTS="dry-run"; npm run apply:ai-fixes

# Debug LLM payloads
$env:LMSTUDIO_LOG_PROMPTS="true"; npm run analyze:results
```

---

## Related docs

- [LOCAL-RUN.md](LOCAL-RUN.md) — setup, env vars, troubleshooting
- [SELF-HOSTED-RUNNER.md](SELF-HOSTED-RUNNER.md) — GitHub Actions + self-hosted runner
- [README.md](../README.md) — project overview and file map
