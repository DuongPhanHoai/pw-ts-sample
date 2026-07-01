# Documentation index

**Start here:** [README.md](../README.md) — project overview, quick start, and links to everything below.

This folder holds **detailed guides**. Use README for “what is this repo?”; use these files when you run, configure, or extend the pipeline.

---

## Guides

| Doc | Audience | Contents |
|-----|----------|----------|
| **[LOCAL-RUN.md](LOCAL-RUN.md)** | Developers on a laptop | `npm run pipeline:local`, `.env`, reports, auto-heal modes **without** GitHub Actions |
| **[SELF-HOSTED-RUNNER.md](SELF-HOSTED-RUNNER.md)** | CI on your Windows machine | Install runner, trigger **Playwright CI with Local AI**, artifacts, **auto PR**, troubleshooting |
| **[AI-POST-AUTO-HEAL.md](AI-POST-AUTO-HEAL.md)** | Design & reference | Two-phase analyze, apply policy, LLM flow, safety, file map |

### AI test (evaluation & fixtures)

| Doc | Audience | Contents |
|-----|----------|----------|
| **[../ai-test/docs/LLM-EVAL-STRATEGY.md](../ai-test/docs/LLM-EVAL-STRATEGY.md)** | Leadership & evaluation | CEO-ready value case, LLM scorecard, rollout strategy |
| **[../ai-test/docs/ideas.md](../ai-test/docs/ideas.md)** | Evaluation plan | LLM metrics, golden corpus, eval harness, observability |
| **[../ai-test/docs/Strategy.md](../ai-test/docs/Strategy.md)** | Strategy (short) | Offline fixture eval; one case at a time; not CI |
| **[../ai-test/inputs/](../ai-test/inputs/)** | Reusable fixtures | One folder per case (`<case-label>/results.json`, html, css, ground truth) |

---

## Pipeline at a glance

```
Playwright tests
    → analyze:results   (triage LLM + fix-plan LLM)
    → apply:ai-fixes    (LLM rewrites test files when AUTO_FIX_TESTS=true)
    → re-run --last-failed
    → create-ai-fix-pr  (branch + PR into trigger branch; plan in PR body)
```

| Stage | Script / workflow step | Main outputs |
|-------|------------------------|--------------|
| Test | `npm test` | `reports/results.json`, `playwright-report/` |
| Analyze | `npm run analyze:results` | `ai-fix-plan.json`, `ai-test-report.md`, `ai-triage.json` |
| Apply | `npm run apply:ai-fixes` | Modified `tests/**`, `auto-fix-audit.json` |
| PR (CI) | `scripts/create-ai-fix-pr.ps1` | Branch `ai-fix/run-<id>`, GitHub PR with **AI fix plan** section |

---

## Workflows (`.github/workflows/`)

| File | Status | Purpose |
|------|--------|---------|
| **`playwright-ai-ci.yml`** | **Active** | Self-hosted Windows: tests + AI + optional auto-heal + PR |
| **`playwright.yml`** | **Disabled** (`on: []`) | Former GitHub-hosted smoke; kept for reference |

---

## Key environment variables

| Variable | Local default | CI (AI workflow) |
|----------|---------------|------------------|
| `AUTO_FIX_TESTS` | `false` in `.env` | `"true"` in workflow job `env` |
| `TEST_ENV` | `dev` | `workflow_dispatch` input or `dev` |
| `LMSTUDIO_*` | `.env` | Repo variables + optional secrets |

See [LOCAL-RUN.md](LOCAL-RUN.md) and [SELF-HOSTED-RUNNER.md](SELF-HOSTED-RUNNER.md) for full lists.

---

## Tracing a failure to a changed file

1. **`reports/results.json`** — `failures[].testName`, `failureLocation` (browser → code line)
2. **`reports/ai-fix-plan.json`** — `plan[]` with `rootCauseSummary`, `codeChangeHints`
3. **`reports/auto-fix-audit.json`** — what apply actually wrote (`filePath`, `applyTarget`)
4. **PR description** — matched plan rows under **### AI fix plan**
