# AI test inputs (reusable fixtures)

Saved **Playwright failure output** for offline LLM eval. Each **folder name is the case label**.

Fixtures live under **`ai-test/inputs/<case-label>/`** (see [TESTING-SCENARIOS.md](../docs/TESTING-SCENARIOS.md)). To add a new case later: run Playwright with an intentional failure, copy `reports/results.json` and attachments into a new folder, add `groundtruth.json`.

---

## Folder layout (per case)

```
ai-test/inputs/<case-label>/
  results.json
  error-context.md
  page-html.html
  page-css.css
  groundtruth.json      # optional, for scored eval
  README.md             # optional
```

Copy from a failing Playwright run:

| File | From |
|------|------|
| `results.json` | `reports/results.json` (trim to relevant failures if needed) |
| `error-context.md` | `test-results/.../error-context.md` |
| `page-html.html` | `test-results/.../page.html` or attachment |
| `page-css.css` | `test-results/.../page.css` or attachment |
| `groundtruth.json` | See [LLM-EVAL-STRATEGY.md](../docs/LLM-EVAL-STRATEGY.md) |

Attachment files in the case folder are wired automatically when loading `results.json` (see `ai-test/src/lib/case-report.ts`).

---

## Run suite

Requires LM Studio + `.env`.

```bash
npm run ai-test:suite
npm run ai-test:suite -- --case <case-label> --open
start reports\ai-test-suite.md
```

See [TESTING-SCENARIOS.md](../docs/TESTING-SCENARIOS.md) for cases to create. Strategy: [Strategy.md](../docs/Strategy.md).
