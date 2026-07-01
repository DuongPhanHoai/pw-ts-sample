# AI test inputs (reusable fixtures)

Saved **Playwright failure output** for offline eval. **Not** executed by the Playwright pipeline or CI—each folder is data you load when running **one case at a time** (eval scripts or, later, analyze replay).

Each case is one **folder**; the **folder name is the label**.
Example names:

- `checkout-btn-locator`
- `inventory-cart-item-typo`
- `trap-backend-500`

---

## Folder layout (per case)

```
ai-test/inputs/<case-label>/
  results.json          # Playwright report JSON (full run or trimmed failures-only)
  page-html.html        # page-html attachment at failure (if captured)
  page-css.css          # page-css attachment at failure (if captured)
  error-context.md      # error-context attachment (optional)
  groundtruth.json      # expected triage + fix-plan (optional, for eval)
  README.md             # one-line human note (optional)
```

| File | Source |
|------|--------|
| `results.json` | `reports/results.json` after a failing run (or export one failure into report shape) |
| `page-html.html` | `test-results/.../page-html-*.html` or attachment export |
| `page-css.css` | `test-results/.../page-css-*.css` or attachment export |
| `error-context.md` | `test-results/.../error-context.md` |
| `groundtruth.json` | Hand-written expected groups, category, file/line, before/after, and policy outcome (see [LLM-EVAL-STRATEGY.md](../docs/LLM-EVAL-STRATEGY.md)) |

---

## How to capture from a real run

### Option A — scan and export (recommended)

After a failing Playwright run:

```bash
npm run ai-test:scan
npm run ai-test:capture -- --label locator-checkout-btn --group 0 --scope single
npm run ai-test:capture -- --label duplicate-matrix-locator --group 0 --scope group
```

Reads `reports/results.json` and copies attachments from `test-results/` into `ai-test/inputs/<label>/`.

| Flag | Meaning |
|------|---------|
| `--group <id>` | Root-cause group from scan (default `0`) |
| `--scope single` | One failure + trimmed `results.json` |
| `--scope group` | All failures sharing the same root cause |
| `--scope all` | Entire failure set from the last run |

Also writes `capture-meta.json` (source paths, member test names).

### Option B — manual copy

1. Run tests once with failures and attachments enabled (`tests/fixtures.ts` captures page-html / page-css on failure).
2. Copy from the repo after the run:
   - `reports/results.json`
   - Matching files under `test-results/` for the failing test(s)
3. Create `ai-test/inputs/<case-label>/` and paste files using the names above.
4. Add `groundtruth.json` when you want scored eval (Phase 1 in [LLM-EVAL-STRATEGY.md](../docs/LLM-EVAL-STRATEGY.md)).

---

## Usage (planned)

- **Per case:** `npm run eval:triage -- --case checkout-btn-locator` loads `ai-test/inputs/checkout-btn-locator/` only (no Playwright).
- **Later:** `analyze:results -- --case checkout-btn-locator` — same folder, full analyze path, still no browser.
- **Compare models:** same input folder, different `LMSTUDIO_MODEL`, compare `reports/llm-eval-summary.json`.
---

## Conventions

- **Folder name:** lowercase, hyphen-separated, describes root cause (not run id or date).
- **Do not** commit secrets or huge traces; trim `results.json` to relevant failures if needed.
- Start with **5–8 cases** covering single-root multi-test, mixed-root, and policy traps; grow toward **15 cases** once the scoring harness is stable.

See [TESTING-SCENARIOS.md](../docs/TESTING-SCENARIOS.md) for the concrete cases to create first. Fixtures are separate from the Playwright CI pipeline; see [Strategy.md](../docs/Strategy.md).
