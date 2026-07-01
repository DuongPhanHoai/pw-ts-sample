# AI test

**Offline evaluation** of LLM triage/fix quality using **saved Playwright output**—not live runs, not CI, not `pipeline:local`.

| Path | Purpose |
|------|---------|
| **[src/](src/)** | AI test source (scan/capture, future eval harness) |
| **[docs/Strategy.md](docs/Strategy.md)** | Capture → one case at a time → wire analyze later |
| **[docs/LLM-EVAL-STRATEGY.md](docs/LLM-EVAL-STRATEGY.md)** | Leadership value, canonical scorecard, promotion rules, rollout |
| **[docs/TESTING-SCENARIOS.md](docs/TESTING-SCENARIOS.md)** | Concrete fixture scenarios to create first |
| **[docs/ideas.md](docs/ideas.md)** | Eval harness shape, logging, optional tools, observability |
| **[inputs/](inputs/)** | One folder per case (`<case-label>/results.json`, attachments, ground truth) |

```bash
npm run ai-test:scan
npm run ai-test:capture -- --label <case-label> --group 0 --scope single
```

Playwright + CI pipeline: **[docs/](../docs/README.md)**.
