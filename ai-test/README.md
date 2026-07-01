# AI test

**Offline evaluation** of LLM triage/fix quality using **saved Playwright output**—not live runs, not CI, not `pipeline:local`.

| Path | Purpose |
|------|---------|
| **[docs/Strategy.md](docs/Strategy.md)** | Capture → one case at a time → wire analyze later |
| **[docs/ideas.md](docs/ideas.md)** | Metrics, eval harness shape, optional tools |
| **[inputs/](inputs/)** | One folder per case (`<case-label>/results.json`, attachments, ground truth) |

Playwright + CI pipeline: **[docs/](../docs/README.md)**.
