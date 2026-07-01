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

Each run appends rows to **`reports/ai-test-history/summary.csv`** keyed by `model` (`LMSTUDIO_MODEL`) and `runAt`. Full snapshots live under `reports/ai-test-history/<timestamp>_<model>/`.

Playwright + CI pipeline: **[docs/](../docs/README.md)**.
