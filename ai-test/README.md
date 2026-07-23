# AI test



**Offline LLM evaluation** using saved Playwright fixtures in `ai-test/inputs/<case-label>/`.



| Path | Purpose |

|------|---------|

| **[src/run-suite.ts](src/run-suite.ts)** | Triage LLM on every case |

| **[docs/test-execution.html](docs/test-execution.html)** | Visual execution design (open in browser / print PDF) |
| **[docs/Strategy.md](docs/Strategy.md)** | Workflow and principles |

| **[docs/LLM-EVAL-STRATEGY.md](docs/LLM-EVAL-STRATEGY.md)** | Scorecard and rollout |

| **[docs/TESTING-SCENARIOS.md](docs/TESTING-SCENARIOS.md)** | Scenario folders and ground truth |

| **[inputs/](inputs/)** | Fixture data per case (already on disk) |



## Run eval (LM Studio + `.env` required)



```bash

npm run ai-test:suite

npm run ai-test:suite -- --case <case-label> --open

start ai-reports\ai-test-suite.md

```



Each run adds a column to **`ai-reports/ai-test-history/model_eval_history.csv`** (`{LMSTUDIO_MODEL} @ {UTC timestamp}`), appends **`model_eval_runs.csv`** (run aggregates), **`model_eval_scores.csv`** (per-case triage metrics), and **`model_eval_groundtruth_details.csv`** (expected vs actual comparison rows). Full snapshots live under `ai-reports/ai-test-history/<timestamp>_<model>/`.



| File | Use |

|------|-----|

| `model_eval_history.csv` | Quick pass/fail + triage % matrix across models |

| `model_eval_runs.csv` | Run totals + avg triage score components |

| `model_eval_scores.csv` | Filter by `model` / `case`; compare `triage_score`, grouping F1, category accuracy, etc. |

| `model_eval_groundtruth_details.csv` | Review expected value, actual value, match %, and match/notmatch per check |

| `<timestamp>_<model>/model_eval_groundtruth_details.csv` | Same groundtruth detail rows scoped to one run |



Metrics match [LLM-EVAL-STRATEGY.md](docs/LLM-EVAL-STRATEGY.md) triage scorecard (Phase 1). Fix-plan and safety columns come when those eval steps are wired.



Playwright + CI pipeline: **[docs/](../docs/README.md)**.


