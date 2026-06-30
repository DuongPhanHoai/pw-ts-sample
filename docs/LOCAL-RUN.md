# Local run guide

Run Playwright tests + LM Studio AI analysis on your laptop **without GitHub Actions**.

**Project:** `D:\Testing\pw-ts-sample`  
**No self-hosted runner required** for this guide (`run.cmd` is optional and only for GitHub CI).

---

## What you get

```
npm run pipeline:local
        │
        ├─► Playwright tests (SauceDemo)
        ├─► AI test report (pass/fail, tests to fix)
        └─► Optional auto-heal (controlled by AUTO_FIX_TESTS)
```

| Output | Path |
|--------|------|
| **Main AI report** | `reports/ai-test-report.md` |
| Structured report | `reports/ai-test-report.json` |
| Playwright JSON | `reports/results.json` |
| HTML report | `playwright-report/index.html` |
| Fix plan (if failures) | `reports/ai-fix-plan.json` |
| Triage groups (step 1) | `reports/ai-triage.json` |

See **[AI-POST-AUTO-HEAL.md](AI-POST-AUTO-HEAL.md)** for the full post-failure analyze + auto-heal design.

---

## Prerequisites

| Tool | Check | Install |
|------|--------|---------|
| Node.js 20+ | `node -v` | https://nodejs.org |
| npm | `npm -v` | Included with Node |
| Git | optional | https://git-scm.com |
| **LM Studio** | Server running | https://lmstudio.ai |

### LM Studio

1. Load model **`google/gemma-4-e4b`** in LM Studio.
2. Start the **local server** (default port often `1234`).
3. Confirm the API URL in LM Studio matches your `.env` (example below uses `192.168.1.166:1234`).

---

## One-time setup

Open PowerShell:

```powershell
cd D:\Testing\pw-ts-sample

# 1. Environment file
copy .env.example .env
# Edit .env if your LM Studio URL or model name differs

# 2. Dependencies
npm install

# 3. Playwright browser (Chromium)
npx playwright install chromium
```

### `.env` (minimum)

```env
LMSTUDIO_BASE_URL=http://192.168.1.166:1234/v1
LMSTUDIO_MODEL=google/gemma-4-e4b
LMSTUDIO_TIMEOUT_SECONDS=120
LMSTUDIO_BATCH_SIZE=1
LMSTUDIO_MAX_ERROR_CHARS=2000
LMSTUDIO_API_KEY=lm-studio

TEST_ENV=dev
AUTO_FIX_TESTS=false
```

| Variable | Meaning |
|----------|---------|
| `TEST_ENV=dev` | Fast smoke (7 tests) — **recommended for daily runs** |
| `TEST_ENV=test` | Full matrix (32 tests) |
| `AUTO_FIX_TESTS=false` | Analysis only — **start here** |

---

## Run the full pipeline (recommended)

```powershell
cd D:\Testing\pw-ts-sample

# Start LM Studio server first, then:
npm run pipeline:local
```

Open the report:

```powershell
start reports\ai-test-report.md
# or
code reports\ai-test-report.md
```

### What the pipeline does

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `npm test` | Run Playwright against saucedemo.com |
| 2 | `npm run analyze:results` | LM Studio writes AI report |
| 3 | `npm run apply:ai-fixes` | Respects `AUTO_FIX_TESTS` (default: skip fixes) |

---

## Run step by step

Useful when debugging one stage:

```powershell
cd D:\Testing\pw-ts-sample

# Step 1 — tests only
$env:TEST_ENV="dev"
npm test

# Step 2 — AI report (needs reports/results.json from step 1)
npm run analyze:results

# Step 3 — optional auto-heal
$env:AUTO_FIX_TESTS="false"   # or dry-run | true
npm run apply:ai-fixes
```

View HTML Playwright report:

```powershell
npm run show-report
```

---

## Auto-heal modes

Set in `.env` or for one run in PowerShell:

```powershell
$env:AUTO_FIX_TESTS="false"     # default — report only
$env:AUTO_FIX_TESTS="dry-run"  # show what would change
$env:AUTO_FIX_TESTS="true"      # apply fixes + re-run failed tests
npm run pipeline:local
```

Policy rules live in:

- `testing-standards/auto-heal-policy.json`
- `testing-standards/evaluation-criteria.md`

---

## TEST_ENV matrix

| Value | Tests | When to use |
|-------|-------|-------------|
| `dev` | ~7 | Daily / fast feedback |
| `test` | ~32 | Full regression |
| `stg` | subset | Pre-prod style |
| `prd` | canary | Minimal safe set |

```powershell
$env:TEST_ENV="test"; npm run pipeline:local
```

---

## Reading the AI report

**All passed** — top of `reports/ai-test-report.md`:

```markdown
> **Status: PASS** — All tests passed
## Tests to fix
_No failing tests — nothing to fix._
```

**Failures** — look for:

- **Tests to fix** table (name, file, category, auto-heal?)
- **Failure details** with error messages
- **Recommendation** next steps

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Playwright report not found` | Run `npm test` first (creates `reports/results.json`) |
| LM Studio timeout | Check server on; verify `LMSTUDIO_BASE_URL`; increase `LMSTUDIO_TIMEOUT_SECONDS` |
| `response_format.type must be json_schema or text` | Fixed in latest code — pull/update `scripts/lib/llm.ts` (LM Studio does not support `json_object`) |
| Connection refused to `192.168.1.166` | Use `http://localhost:1234/v1` if LM Studio runs on same PC |
| `npm test` fails all tests | Check internet; open https://www.saucedemo.com in browser |
| No `reports/` folder | Created automatically on first test run |
| AI report empty / stub | LM Studio not responding — check model loaded |
| Many failures — incomplete fix plan | Keep `LMSTUDIO_BATCH_SIZE=1`; raise `LMSTUDIO_TIMEOUT_SECONDS=180` if a single test times out |

### Many failures (intentional testing)

Each failed test is analyzed **one at a time** by default (`LMSTUDIO_BATCH_SIZE=1`):

```powershell
# e.g. 30 failures → 30 fix-plan calls + 30 analysis calls + 1 summary
npm test
npm run analyze:results
# Check: "Fix plan coverage: 30/30 tests"
# Token summary printed at end + reports/ai-token-estimate.json
```

Tune in `.env`:

```env
LMSTUDIO_BATCH_SIZE=1
LMSTUDIO_TIMEOUT_SECONDS=120
LMSTUDIO_MAX_ERROR_CHARS=2000
# Optional cost estimate (USD per 1M tokens):
# LMSTUDIO_COST_PER_1M_INPUT=0.10
# LMSTUDIO_COST_PER_1M_OUTPUT=0.10
```

Set `LMSTUDIO_BATCH_SIZE=5` only if your model reliably handles multi-test JSON batches.

### Token / cost estimation

Before LLM calls, the analyzer prints a **pre-estimate** (~chars÷4). After the run:

| Output | Contents |
|--------|----------|
| Console | Actual totals if LM Studio returns `usage` |
| `reports/ai-token-estimate.json` | Per-call breakdown (fix-plan, analysis, summary) |
| `reports/ai-analysis.md` | Token summary at top |

Set `LMSTUDIO_COST_PER_1M_INPUT` and `LMSTUDIO_COST_PER_1M_OUTPUT` for rough USD cost.

### Debug: see exactly what is sent to the AI

```powershell
$env:LMSTUDIO_FAILURE_LIMIT="3"   # only first 3 failures (no need to edit results.json)
$env:LMSTUDIO_LOG_PROMPTS="true"  # print USER payload in console + save files
npm run analyze:results
```

Saved under **`reports/llm-prompts/`** (e.g. `fix-plan-test-1.txt`) — each file includes **SYSTEM**, **USER**, and **ASSISTANT** (LLM response) sections plus token usage when available.

Remove the limit for full runs:

```powershell
Remove-Item Env:LMSTUDIO_FAILURE_LIMIT -ErrorAction SilentlyContinue
Remove-Item Env:LMSTUDIO_LOG_PROMPTS -ErrorAction SilentlyContinue
npm run analyze:results
```

### Quick LM Studio check

```powershell
curl http://192.168.1.166:1234/v1/models
```

You should see JSON listing models.

---

## Local vs GitHub self-hosted

| | **Local (`npm run pipeline:local`)** | **GitHub + `run.cmd`** |
|--|--------------------------------------|-------------------------|
| Reports on disk | ✅ `D:\Testing\pw-ts-sample\reports\` | ❌ Download artifact from Actions |
| Needs `run.cmd` | ❌ | ✅ |
| Needs push / Actions | ❌ | ✅ |
| Best for | Daily dev | CI history / team |

For GitHub runner setup see **[SELF-HOSTED-RUNNER.md](SELF-HOSTED-RUNNER.md)**.

---

## Quick reference

```powershell
cd D:\Testing\pw-ts-sample
npm run pipeline:local                    # full pipeline
npm test                                  # tests only
npm run analyze:results                   # AI report only
npm run show-report                       # HTML report
start reports\ai-test-report.md           # open AI report
```
