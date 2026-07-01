# Strategy (short)

**`ai-test/` is not the Playwright pipeline.** Cases here do not run in CI, self-hosted workflows, or `npm run pipeline:local`. That automation lives under `docs/` and `.github/workflows/`.

This area is for **offline evaluation** of LLM analyze/fix behavior using **saved Playwright output**—not live browser runs.

---

## Workflow

1. **Capture once (manual)**  
   Run Playwright when you need real failure output. Copy artifacts into **`ai-test/inputs/<case-label>/`** (folder name = stable label).

2. **Run one case at a time**  
   Each folder is one eval case. Load that folder’s `results.json` and attachments; call triage / fix-plan (or thin eval scripts) **for that case only**. No Playwright re-run, no full analyze → apply → PR chain.

3. **Wire the repo AI pipeline later**  
   When ready, point `analyze_results` (and apply) at `ai-test/inputs/<case-label>/` via a `--case` replay flag. Until then: build the corpus, ground truth, and per-case runs.

---

## Principles

- **Fixture-first** — LLM inputs are files on disk (`results.json`, `error-context.md`, page HTML/CSS), not a fresh test execution.
- **Isolated from CI** — Compare models and prompts on your machine; do not tie eval to GitHub Actions or runner setup.
- **Safety mindset** (for when apply is hooked up) — Policy traps in `inputs/` should prove the model refuses bad auto-heals; scoring comes from [ideas.md](ideas.md).

Playwright pipeline design (analyze, apply, PR): **[docs/AI-POST-AUTO-HEAL.md](../../docs/AI-POST-AUTO-HEAL.md)**.
