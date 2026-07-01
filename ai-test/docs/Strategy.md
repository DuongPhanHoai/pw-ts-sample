# Strategy (short)

**`ai-test/` is not the Playwright pipeline.** Cases here do not run in CI, self-hosted workflows, or `npm run pipeline:local`. That automation lives under `docs/` and `.github/workflows/`.

This area is for **offline LLM evaluation** using **saved Playwright output** in `ai-test/inputs/` — not live browser runs.

---

## Workflow

1. **Fixtures on disk**  
   Each case is a folder **`ai-test/inputs/<case-label>/`** with `results.json`, attachments, and optional `groundtruth.json`. Build these manually from a Playwright run (copy from `reports/` and `test-results/`).

2. **Run suite (LLM)**  
   `npm run ai-test:suite` calls the **triage LLM** on each case. No Playwright, no scan/capture tooling, no full analyze → apply → PR chain.

3. **Wire analyze replay later (optional)**  
   Point `analyze_results` at `ai-test/inputs/<case-label>/` via a future `--case` flag for fix-plan and apply.

---

## Principles

- **Fixture-first** — LLM reads files on disk, not a fresh test run.
- **Suite-only entry point** — one command: `npm run ai-test:suite`.
- **Isolated from CI** — local LM Studio; not tied to GitHub Actions.
- **Safety** — trap cases + scorecard in [LLM-EVAL-STRATEGY.md](LLM-EVAL-STRATEGY.md).

Playwright pipeline: **[docs/AI-POST-AUTO-HEAL.md](../../docs/AI-POST-AUTO-HEAL.md)**.

Doc roles:

- [Strategy.md](Strategy.md) — this file.
- [LLM-EVAL-STRATEGY.md](LLM-EVAL-STRATEGY.md) — scorecard, promotion rules, CEO view.
- [TESTING-SCENARIOS.md](TESTING-SCENARIOS.md) — which folders to create under `inputs/`.
- [ideas.md](ideas.md) — future eval harness, logging, tools.
