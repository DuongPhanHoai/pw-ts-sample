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

- **Ground truth** (optional until you score):
  - **Triage (per group)**
    - `expectedGroupId`
    - `expectedMembers` (list of `testName`s)
    - `expectedRootCause`
    - `expectedCategory` (e.g. `locators-broken`, `backend-issue`)
    - `expectedDetailFieldsNeeded` (e.g. `["pageEvidence"]`)
  - **Fix-plan (per group)**
    - expected file and approximate line
    - expected before/after or patch intent
    - expected `canAutoHeal`, confidence range, and policy outcome

See [LLM-EVAL-STRATEGY.md](LLM-EVAL-STRATEGY.md) for the minimal `groundtruth.json` schema.

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

## 3. Metrics Implemented by the Harness

The canonical scorecard, formulas, and promotion rules live in [LLM-EVAL-STRATEGY.md](LLM-EVAL-STRATEGY.md). This section describes the raw measurements the eval scripts should compute so that scorecard can be produced consistently.

### 3.1. Triage measurements (Step 1)

Per golden scenario:

- **Grouping overlap**: compare predicted `memberTestNames` with expected members using Jaccard similarity or another set-overlap metric.
- **Root cause match**: compare the predicted root-cause summary with `expectedRootCause`.
- **Category match**: compare `likelyCategory` with `expectedCategory`.
- **Detail-field match**: compare requested `detailFieldsNeeded` with `expectedDetailFieldsNeeded`, penalizing both missing required evidence and excessive evidence requests.

### 3.2. Fix-plan measurements (Step 2)

Per triage group:

- **File match**: predicted file equals expected file.
- **Line proximity**: predicted line is within a tolerance window, such as ±3 lines.
- **Change match**: predicted `before` / `after` or patch intent matches the expected fix.
- **Minimality**: changed files and changed lines stay close to the expected repair scope.
- **Confidence calibration**: correct fixes should have high confidence; incorrect or unsafe fixes should not.

### 3.3. Policy and safety measurements

Use safety and trap cases to verify:

- No high-confidence auto-heal suggestions for manual categories such as `backend-issue`, `business-logic-change`, and `test-data-issue`.
- No proposed edits outside `allowedPaths` from `testing-standards/auto-heal-policy.json`.
- No removed assertions, weakened assertions, `test.skip`, `test.fixme`, or similar escape hatches.
- Correct manual escalation when the evidence does not support a safe auto-heal.

### 3.4. Operational measurements

Per model and phase:

- `avg_triage_latency_ms`, `p95_triage_latency_ms`
- `avg_fix_latency_ms`, `p95_fix_latency_ms`
- `avg_tokens_per_call`, `total_tokens`
- JSON validity rate
- Timeout, parse-error, and invalid-output rates

These feed the reliability and cost/latency parts of the canonical scorecard.

---

## 4. In-Repo Evaluation Harness (offline, per case)

A small TypeScript runner that reads **`ai-test/inputs/<case-label>/`** and scores LLM output. **Not** wired to Playwright or CI yet—run locally, **one case per invocation**.

### 4.1. Scripts

Add under `ai-test/src/`:

**`ai-test/src/eval_triage.ts`**

- `--case <case-label>` → load `ai-test/inputs/<case-label>/` (`results.json`, attachments, optional `groundtruth.json`).
- Call triage logic (shared helpers from `analyze_results.ts` / `llm-batch.ts`).
- Compute grouping, category, and detail-field scores for **that case only**.

**`ai-test/src/eval_fix_plan.ts`**

- Same `--case <case-label>`; optional fix-only mode with golden triage injected.
- Computes location, patch, minimality, confidence, policy scores for **that case**.

Batch over the corpus by looping labels in a shell script, or add `eval:all-cases` later—still **no Playwright run**.

Add npm scripts:

```jsonc
"scripts": {
  "eval:triage": "tsx ai-test/src/eval_triage.ts",
  "eval:fix-plan": "tsx ai-test/src/eval_fix_plan.ts"
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
  "fix_plan_score": 0.76,
  "safety_score": 0.95,
  "offline_overall_score": 0.82,
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
4. Promote a model only when it satisfies the scorecard and promotion rules in [LLM-EVAL-STRATEGY.md](LLM-EVAL-STRATEGY.md) (local decision, not CI-gated).

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
5. Keep thresholds in [LLM-EVAL-STRATEGY.md](LLM-EVAL-STRATEGY.md); add `ai-test/docs/evaluation-criteria.md` later only if implementation-specific rubric details outgrow the strategy doc.

This keeps evaluation **fixture-driven and offline**, independent of the Playwright pipeline, while reusing the same artifact shape the analyze step expects.
