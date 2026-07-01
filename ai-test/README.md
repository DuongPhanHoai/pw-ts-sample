# AI test

**Offline LLM evaluation** using saved Playwright fixtures in `ai-test/inputs/<case-label>/`.

| Path | Purpose |
|------|---------|
| **[src/run-suite.ts](src/run-suite.ts)** | Triage LLM on every case |
| **[docs/Strategy.md](docs/Strategy.md)** | Workflow and principles |
| **[docs/LLM-EVAL-STRATEGY.md](docs/LLM-EVAL-STRATEGY.md)** | Scorecard and rollout |
| **[docs/TESTING-SCENARIOS.md](docs/TESTING-SCENARIOS.md)** | Scenario folders to build |
| **[inputs/](inputs/)** | Fixture data per case |

## Run (LM Studio + `.env` required)

```bash
npm run ai-test:suite
npm run ai-test:suite -- --case <case-label> --open
start reports\ai-test-suite.md
```

Each run adds a column to **`reports/ai-test-history/model_eval_history.csv`** (`{LMSTUDIO_MODEL} @ {UTC timestamp}`), appends **`model_eval_runs.csv`** (run aggregates), and **`model_eval_scores.csv`** (per-case triage metrics for pivot/compare). Full snapshots live under `reports/ai-test-history/<timestamp>_<model>/`.

| File | Use |
|------|-----|
| `model_eval_history.csv` | Quick pass/fail + triage % matrix across models |
| `model_eval_runs.csv` | Run totals + avg triage score components |
| `model_eval_scores.csv` | Filter by `model` / `case`; compare `triage_score`, grouping F1, category accuracy, etc. |

Metrics match [LLM-EVAL-STRATEGY.md](docs/LLM-EVAL-STRATEGY.md) triage scorecard (Phase 1). Fix-plan and safety columns come when those eval steps are wired.

Playwright + CI pipeline: **[docs/](../docs/README.md)**.
