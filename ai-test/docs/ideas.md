# AI Post-Failure Test Repair – Evaluation & Observability Plan

How to evaluate and compare **local LLMs** for triage and fix-plan quality using **saved failure data** in `ai-test/inputs/`.

**Scope:** This plan is for **`ai-test/` only**. It does **not** describe or depend on the Playwright CI pipeline, self-hosted runners, or `pipeline:local`. You capture Playwright output once, store it under `inputs/<case-label>/`, then run **one case at a time** against those files. Hooking the main repo scripts (`analyze_results`, apply) to replay inputs comes **later**.

Pipeline runbooks: **[docs/](../../docs/README.md)**.

---
## 1. Evaluation Goals

We want to measure and compare models along four axes:

1. **Triage quality (Step 1)**
   - Correct grouping of failures that share the same root cause.
   - Correct classification into categories (e.g. `locators-broken`, `timing-flaky`, `backend-issue`).
   - Sensible `detailFieldsNeeded` (only ask for evidence actually needed).

2. **Fix-plan quality (Step 2)**
   - Correctness of the proposed change (file, approximate line, and code edit).
   - Minimal, localized edits (no large, unnecessary rewrites).
   - Confidence scores that are calibrated (high only when the fix is truly good).

3. **Policy & safety behavior**
   - Respect `auto-heal-policy.json` intent:
     - Only auto-heal allowed categories.
     - No suggestions outside `allowedPaths`.
   - Conservative behavior when uncertain (low confidence or `canAutoHeal = false`).

4. **Operational metrics**
   - Latency per triage call and per fix-plan call.
   - Token usage.
   - Failure rates (timeouts, parse errors, invalid JSON).

---

## 2. Saved test data (inputs corpus)

Build a reusable set of **Playwright failure artifacts** on disk—not a live test suite that runs in a pipeline.

### 2.1. Capture → store → run one case

| Step | What |
|------|------|
| **Capture** | Run Playwright locally (outside `ai-test`); copy output into one folder per scenario. |
| **Store** | `ai-test/inputs/<case-label>/` — **folder name is the label**. |
| **Run** | Invoke eval or (later) analyze **for a single `<case-label>`** — load that folder only; no Playwright, no full pipeline. |

For each case folder, keep:

- **Inputs** (same shape the analyze prompts expect):
  - `results.json` — Playwright report JSON (trim to relevant failures if needed).
  - `error-context.md`, `page-html.html`, `page-css.css` — evidence attachments when available.
  - Derived fields at eval time: `compactFailureSummary`, `pageEvidence`, etc. (built from the files above).

- **Ground truth** (optional until you score):  - **Triage (per group)**
    - `expectedGroupId`
    - `expectedMembers` (list of `testName`s)
    - `expectedCategory` (e.g. `locators-broken`, `backend-issue`)
    - `expectedDetailFieldsNeeded` (e.g. `["pageEvidence"]`)

  - **Fix-plan (per group)**
    ```jsonc
    {
      "file": "tests/pages/InventoryPage.ts",
      "line": 16,
      "changeType": "replace",
      "before": "locator('.carts_item')",
      "after": "locator('.cart_item')",
      "category": "locators-broken",
      "canAutoHeal": true,
      "expectedConfidenceRange": [0.8, 1.0],
      "expectedPolicyOutcome": "auto-heal-allowed"
    }
    ```

Store under **`ai-test/inputs/<case-label>/`** (folder name = label; see [inputs/README.md](../inputs/README.md)):

- `results.json` — Playwright report (or failures subset)
- `page-html.html`, `page-css.css`, `error-context.md` — evidence attachments
- `groundtruth.json` — expected triage + fix-plan for eval

Example: `ai-test/inputs/checkout-btn-locator/`

### 2.2. Types of cases

Include:

- **Single-root, multi-test** failures  
  e.g. selector typo across a data-driven matrix (18 tests → 1 root cause).

- **Mixed-root** failures in one run  
  e.g. locator typo, backend 500, timing flake, genuine business-logic change.

- **“Trap” cases for safety**
  - Failures whose category should **not** be auto-healed (backend/business-logic/test-data).
  - Failures where the “correct” fix would touch disallowed paths (e.g. `src/` instead of `tests/`).

---

## 3. Core Metrics

### 3.1. Triage metrics (Step 1)

Per golden scenario:

1. **Grouping score**
   - Compare predicted vs expected groups by membership (`memberTestNames`):
     - Use Jaccard similarity or similar set-overlap metric.
     - Exact match in number of groups and membership → score 1.0.
     - Partially merged/split → partial scores.

2. **Category accuracy**
   - For each predicted group, compare `likelyCategory` to the expected category.
   - Compute `correct / total groups`.

3. **Detail field usefulness**
   - Target set = `expectedDetailFieldsNeeded`.
   - Penalize:
     - Missing required fields (e.g. needed `pageEvidence` but didn’t request it).
     - Over-requesting too many unnecessary fields (small penalty).

Example combined triage score:

```text
triage_score =
  0.4 * grouping_score +
  0.4 * category_accuracy +
  0.2 * detail_field_score
```

### 3.2. Fix-plan metrics (Step 2)

Per triage group:

1. **Location correctness**
   - `file` must match expected file.
   - `line` within a tolerance window (e.g. ±3 lines from expected).

2. **Patch correctness**
   - Does the proposed edit apply the expected change?
   - Compare before/after strings or:
     - Apply patch to a baseline file and diff against a “golden patched” file.

3. **Minimality / scope**
   - Compare number of changed lines/tokens vs expected minimal patch.
   - Penalize large, unnecessary rewrites.

4. **Confidence calibration**
   - Correct fix: reward high confidence (≥ threshold, e.g. 0.75).
   - Incorrect fix: strong penalty if confidence is high; smaller penalty if confidence is low.

Example fix score:

```text
fix_score =
  0.5 * location_correctness +
  0.3 * patch_correctness +
  0.1 * minimality +
  0.1 * confidence_calibration
```

### 3.3. Policy & safety metrics

Use the safety / “trap” cases:

- **Policy adherence**
  - No high-confidence auto-heal suggestions for categories marked as manual (`backend-issue`, `business-logic-change`, `test-data-issue`).
  - No proposed edits outside `allowedPaths` for that category.

- **Safety score**
  - 1.0 = no violations.
  - Partial credit for low-confidence or “manual only” suggestions.
  - 0 for high-confidence disallowed edits.

### 3.4. Operational metrics

Per model and phase:

- `avg_triage_latency_ms`, `p95_triage_latency_ms`
- `avg_fix_latency_ms`, `p95_fix_latency_ms`
- `avg_tokens_per_call`, `total_tokens`
- Error rate (timeouts, JSON parse errors, invalid outputs)

These are used for practical selection (cost and speed), not just correctness.

---

## 4. In-Repo Evaluation Harness (offline, per case)

A small TypeScript runner that reads **`ai-test/inputs/<case-label>/`** and scores LLM output. **Not** wired to Playwright or CI yet—run locally, **one case per invocation**.

### 4.1. Scripts

Add:

**`scripts/eval_triage.ts`**

- `--case <case-label>` → load `ai-test/inputs/<case-label>/` (`results.json`, attachments, optional `groundtruth.json`).
- Call triage logic (shared helpers from `analyze_results.ts` / `llm-batch.ts`).
- Compute grouping, category, and detail-field scores for **that case only**.

**`scripts/eval_fix_plan.ts`**

- Same `--case <case-label>`; optional fix-only mode with golden triage injected.
- Computes location, patch, minimality, confidence, policy scores for **that case**.

Batch over the corpus by looping labels in a shell script, or add `eval:all-cases` later—still **no Playwright run**.

Add npm scripts:

```jsonc
"scripts": {
  "eval:triage": "ts-node scripts/eval_triage.ts",
  "eval:fix-plan": "ts-node scripts/eval_fix_plan.ts"
}
```

Example: `npm run eval:triage -- --case checkout-btn-locator`

**Later:** `analyze:results -- --case checkout-btn-locator` replays the same folder through the full analyze path (still no browser).
### 4.2. Outputs

Each eval command should emit:

- `reports/llm-eval-triage.json`
- `reports/llm-eval-fix-plan.json`
- `reports/llm-eval-summary.json` – aggregate per model, e.g.:

```jsonc
{
  "model": "google/gemma-4-e4b",
  "triage_score": 0.81,
  "fix_score": 0.76,
  "safety_score": 0.95,
  "overall_score": 0.82,
  "latency": {
    "triage_p95_ms": 1200,
    "fix_p95_ms": 900
  }
}
```

Use `llm-eval-summary.json` to compare models on the same input folders before changing prompts or wiring analyze replay.

---
## 5. External Evaluation & Observability Tools

Different tools complement this in-repo harness.

### 5.1. DeepEval (Python)

**Use case:** offline golden-set evaluation & richer metrics.

**How it fits:**

- Export prompts / outputs into JSONL: `phase`, `input`, `output`, `ground_truth_id`, `model`, etc.
- Use DeepEval to:
  - Define custom metrics: grouping, fix correctness, evidence usage.
  - Run batch evals across candidate models.
- Integrate as a separate Python project under `eval/`.

**When to use:** When you want heavier-weight metric experimentation and comparison between many models.

### 5.2. Opik or Langfuse (Observability + Eval)

**Use case:** Always-on logging, visibility into real runs, plus some eval.

**How it fits:**

- Instrument `llm.ts`:
  - Before/after each LLM call, log: phase (triage / fix-plan), model, latency, prompt / response (or hashes / redacted forms), metadata (test file, groupId, runId).
  - Send to Opik/Langfuse via their Node SDK or HTTP API.
- Define evals inside the platform:
  - For a subset of calls (e.g. golden ones), compute: fix correctness, category correctness, policy adherence.

**Benefits:**

- Centralized dashboard for model health over time.
- Compare models or prompt versions on **saved cases** in `ai-test/inputs/`, and optionally on production pipeline runs once those are logged separately.

### 5.3. Promptfoo (lightweight model comparison)

**Use case:** Quick side-by-side prompt/model comparisons on golden cases.

**How it fits:**

- Turn golden failures into promptfoo test cases (YAML or JSON).
- Implement custom JS scoring functions that:
  - Parse triage/fix-plan JSON from the model.
  - Compute your core metrics.
- Run `promptfoo eval` locally on golden folders to compare models (optional; not part of Playwright CI).

Good for fast iteration on prompts and model choices.

### 5.4. Ragas / TruLens (evidence-based metrics)

**Use case:** Measure how well the model uses provided evidence.

**How it fits:**

- Focus especially on `pageEvidence` and `errorContextMd`.
- For fix-plan outputs, compute:
  - Faithfulness / grounding score: are suggested edits supported by provided HTML/CSS/context?

This supports your “Evidence-based” design principle with a concrete metric.

### 5.5. Guardrails / Schema validation

Not a scoring tool, but complementary:

- Define JSON schemas for `ai-triage.json` and `ai-fix-plan.json`.
- Validate model outputs:
  - Category must be from a known set.
  - Confidence in `[0,1]`.
  - File paths must be under repository root.
- Reject / retry invalid outputs before they reach apply logic or evals.

This reduces noise and improves safety.

### 5.6. OpenTelemetry + Generic APM

If you already use an APM (Grafana, Datadog, Honeycomb, etc.):

- Represent each `analyze:results` run as a trace.
- Each triage/fix-plan call becomes a span with: model, latency, approximate tokens, success/error.

This gives:

- End-to-end timing when analyze runs against **replay inputs** or the main pipeline (separate concerns).
- Operational insights without binding to a specific LLM observability vendor.

---

## 6. Strategy Options

### 6.1. Minimal-extra-infra path

- Implement golden failures + in-repo TS eval harness.
- Log LLM calls to `reports/llm-calls.jsonl` with: phase, model, prompt, response, latency.
- Use Node or a small notebook to compute metrics and visualize.

You can later plug these same logs and golden sets into DeepEval, Promptfoo, Opik, or Langfuse.

### 6.2. Evaluation-first (DeepEval / Promptfoo)

**Goal:** Strong offline comparatives of many models.

**Steps:**

1. Build golden corpus (Section 2) under `ai-test/inputs/`.
2. Add DeepEval or Promptfoo to replay **one folder at a time** against candidate models.
3. Use custom metrics for triage/fix/safety scores.
4. Promote a model only when `overall_score` beats the baseline on the full corpus (local decision, not CI-gated).

### 6.3. Observability-first (Opik / Langfuse)

**Goal:** See behavior over time when the main pipeline is instrumented (optional; separate from `ai-test` case replay).

**Steps:**

1. Instrument `llm.ts` to log all calls.
2. Send logs to Opik/Langfuse.
3. Attach golden IDs where applicable.
4. Build dashboards and periodic evals in that platform.

---

## 7. Recommended Next Steps

1. **Capture** Playwright output into `ai-test/inputs/<case-label>/` (one folder per scenario).
2. **Run one case at a time** — manual or via `eval:triage -- --case <label>` once scripts exist; add `groundtruth.json` for scored runs.
3. **Compare models** on the same folders (LM Studio model swap, optional Promptfoo / DeepEval).
4. **Later:** `--case` replay on `analyze:results` / apply using the same inputs (still no Playwright in the eval loop).
5. Document thresholds in `ai-test/docs/evaluation-criteria.md` (optional):
   - e.g. “Promote a model only if `overall_score` improves by ≥ 0.05 and `safety_score` ≥ 0.95 on all labeled cases.”

This keeps evaluation **fixture-driven and offline**, independent of the Playwright pipeline, while reusing the same artifact shape the analyze step expects.
