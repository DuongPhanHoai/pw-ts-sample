# Self-hosted GitHub Actions runner (Windows)

Run **Playwright CI with Local AI** on your laptop using a GitHub self-hosted runner.

**Doc index:** [docs/README.md](README.md) · **Local (no GitHub):** [LOCAL-RUN.md](LOCAL-RUN.md)

**Repository:** [DuongPhanHoai/pw-ts-sample](https://github.com/DuongPhanHoai/pw-ts-sample)  
**Register a new runner (Windows x64):**  
https://github.com/DuongPhanHoai/pw-ts-sample/settings/actions/runners/new?arch=x64&os=win

**Workflow:** `.github/workflows/playwright-ai-ci.yml` (`runs-on: [self-hosted, Windows, X64]`)

---

## What you need on the laptop

| Requirement | Notes |
|-------------|--------|
| Windows 10/11 x64 | Same machine that can reach LM Studio |
| Node.js 20+ | `node -v` |
| Git | For checkout step |
| LM Studio | Server on `http://192.168.1.166:1234` with `google/gemma-4-e4b` loaded |
| Internet | For `npm`, Playwright browser download, saucedemo.com |

Optional: run `npm install` and `npx playwright install chromium` once in the repo folder to warm caches.

---

## Step 1 — Get a registration token

1. Open: https://github.com/DuongPhanHoai/pw-ts-sample/settings/actions/runners/new?arch=x64&os=win  
2. Choose **Windows** / **x64** (link above pre-selects this).  
3. Scroll to **Configure** — copy only the token after `--token` in the example command.  
4. Token is **short-lived (~1 hour)** and is **not** a Personal Access Token.

| Token type | Looks like | Use for runner? |
|------------|------------|-----------------|
| **Runner registration** | `AXXXXXXXX...` (from runners/new page) | ✅ Yes |
| Personal Access Token (PAT) | `ghp_...` | ❌ No — causes 404 |
| Fine-grained PAT | `github_pat_...` | ❌ No |

> If you used a `ghp_` token by mistake, **revoke it** under GitHub → Settings → Developer settings → Personal access tokens.

---

## Step 2 — Install the runner (automated script)

Open **PowerShell as Administrator** (required if installing as a Windows service):

```powershell
cd D:\Testing\pw-ts-sample
.\scripts\install-self-hosted-runner.ps1
```

The script will:

1. Download the latest [actions/runner](https://github.com/actions/runner/releases) for Windows x64  
2. Extract to `C:\actions-runner\pw-ts-sample` (default)  
3. Ask for your registration token  
4. Register with `https://github.com/DuongPhanHoai/pw-ts-sample`  
5. Optionally install/start as a Windows service  

### Manual install (same as GitHub UI)

If you prefer GitHub’s exact commands from the settings page:

```powershell
# Create folder
New-Item -Path C:\actions-runner\pw-ts-sample -ItemType Directory -Force
Set-Location C:\actions-runner\pw-ts-sample

# Download + extract (version from GitHub UI — or use install script for latest)
Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v2.327.1/actions-runner-win-x64-2.327.1.zip -OutFile actions-runner-win-x64.zip
Expand-Archive -Path actions-runner-win-x64.zip -DestinationPath .

# Configure (paste token from Step 1)
.\config.cmd --url https://github.com/DuongPhanHoai/pw-ts-sample --token YOUR_TOKEN_HERE

# Interactive run (good for first test — uses your user PATH)
.\run.cmd
```

**Install as service** (starts on boot; run config from elevated PowerShell):

```powershell
# During config, answer Y to "Run as service", OR after config:
.\svc.cmd install
.\svc.cmd start
Get-Service "actions.runner.*"
```

> **LM Studio + Windows service:** A service running as `NETWORK SERVICE` may not see your user PATH or reach LM Studio the same way as your login. For AI steps, either:
> - Run the runner **interactively** (`.\run.cmd`) while logged in, or  
> - Install the service under **your Windows user** (see GitHub docs: `svc.cmd install --username ...`)

---

## Step 3 — Configure GitHub repo variables

In the repo: **Settings → Secrets and variables → Actions → Variables**

| Variable | Example value |
|----------|----------------|
| `LMSTUDIO_BASE_URL` | `http://192.168.1.166:1234/v1` |
| `LMSTUDIO_MODEL` | `google/gemma-4-e4b` |
| `LMSTUDIO_TIMEOUT_SECONDS` | `60` |

Optional:

| Variable / secret | Values |
|----------|--------|
| `AUTO_FIX_TESTS` | Overridden to `"true"` in workflow job `env` today — auto-heal + PR on every AI CI run |
| `GH_TOKEN` | Optional PAT secret; else `GITHUB_TOKEN` is used for push + PR API |

**PR creation:** uses GitHub REST API in CI (GitHub CLI optional for local `npm run create-ai-fix-pr`).  
Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**, or set secret **`GH_TOKEN`**.

**Secrets** (optional): `LMSTUDIO_API_KEY` — LM Studio usually accepts any placeholder (`lm-studio`).

---

## What the AI workflow does (each run)

| Step | Command / script |
|------|------------------|
| Checkout | `actions/checkout@v4` (or plain `git` if repo blocks `actions/*`) |
| Test | `npm test` |
| Analyze | `npm run analyze:results` |
| Apply | `npm run apply:ai-fixes` |
| Re-run | `npx playwright test --last-failed` |
| **PR** | `scripts/create-ai-fix-pr.ps1` → branch `ai-fix/run-<runId>-<attempt>` → **PR base = branch that triggered the run** |
| Artifacts | `reports/`, `playwright-report/` |

The **PR description** includes an **### AI fix plan** section (root cause, proposed change, hints from `reports/ai-fix-plan.json` for applied files).

---

## Step 4 — Verify runner is online

1. https://github.com/DuongPhanHoai/pw-ts-sample/settings/actions/runners  
2. Runner should show **Idle** (green) when waiting for jobs.  
3. Start LM Studio local server before triggering AI workflow.

---

## Step 5 — Run the workflow

> **`.\run.cmd` does not run tests by itself.** It only listens for GitHub jobs.  
> You must **trigger a workflow** (below). Reports appear **after a job finishes**.

### Manual run (workflow_dispatch)

1. Runner **Idle** (`.\run.cmd` in your actions-runner install folder).  
2. **Actions** → **Playwright CI with Local AI** → **Run workflow**  
3. Pick **branch** (e.g. `saucedemo-ai`) and **TEST_ENV** (default `dev`)  
4. Click **Run workflow**

Works on **push**, **pull_request**, and **manual** triggers.

### From a push

Push to branch `main`, `saucedemo`, or `saucedemo-ai` (see workflow `on:` triggers).

### Where to find reports

| Location | When |
|----------|------|
| **GitHub → Actions → run → Artifacts → `reports`** | After self-hosted job completes (download zip) |
| `ai-test-report.md` inside that zip | Main AI summary (pass/fail, tests to fix) |
| **Pull Requests** tab | Branch `ai-fix/run-<runId>-<attempt>` → PR **fix(tests): AI auto-heal** (base = trigger branch, body includes fix plan) |
| `C:\actions-runner\pw-ts-sample\_work\...\reports\` | During/just after job (runner checkout; cleaned between runs) |
| `D:\Testing\pw-ts-sample\reports\` | **Only** if you run `npm run pipeline:local` locally — **not** from `run.cmd` alone |

**Note:** Only **Playwright CI with Local AI** (self-hosted) produces `ai-test-report.md`.

### Without triggering a workflow

If the runner shows **Idle** and you never started **Playwright CI with Local AI**, there is **no report** — that is expected.

---

## Runner labels and workflow matching

This repo’s AI workflow uses:

```yaml
runs-on: [self-hosted, Windows, X64]
```

GitHub adds these labels automatically on Windows x64 runners.  
To target **only** this machine, add a custom label during config, e.g. `pw-laptop`, then update the workflow:

```yaml
runs-on: [self-hosted, Windows, X64, pw-laptop]
```

---

## Day-to-day checklist

Before relying on CI:

- [ ] Runner process or service is **running**  
- [ ] LM Studio server is **on** at `LMSTUDIO_BASE_URL`  
- [ ] Model `google/gemma-4-e4b` is **loaded** in LM Studio  
- [ ] Laptop can reach `https://www.saucedemo.com`  

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No jobs picked up | Runner offline → start `run.cmd` or `svc.cmd start` |
| Job queued forever | Workflow labels don’t match runner → check Settings → Runners → labels |
| `404` on `runner-registration` | Wrong token — use token from **runners/new** page, not a `ghp_` PAT |
| `analyze:results` timeout | LM Studio not running or wrong `LMSTUDIO_BASE_URL` |
| Playwright browser missing | On runner machine: `npx playwright install chromium` |
| Service can’t reach LM Studio | Run interactively or install service under your user account |
| Token expired on config | Generate new token from runners/new page |
| **Startup failure** — `actions/checkout` not allowed | Repo policy blocks `actions/*`. Workflow uses plain `git`/`npm` steps. Or **Settings → Actions → General** → allow **GitHub-owned** actions |
| `403` cannot create pull requests | **Settings → Actions → General** → enable **Allow GitHub Actions to create and approve pull requests**, or secret `GH_TOKEN` (PAT) |

### Remove / reinstall runner

```powershell
cd C:\actions-runner\pw-ts-sample
.\svc.cmd stop
.\svc.cmd uninstall
.\config.cmd remove --token NEW_REMOVAL_TOKEN
```

Removal token: **Settings → Actions → Runners** → runner → **Remove** → follow prompts.

---

## Two CI workflows in this repo

| Workflow | Runner | Purpose |
|----------|--------|---------|
| `playwright.yml` | `ubuntu-latest` (disabled — `on: []`) | Cloud smoke tests; kept for reference |
| `playwright-ai-ci.yml` | **self-hosted** (your laptop) | Tests + LM Studio AI report + optional auto-heal |

Use **self-hosted** (`playwright-ai-ci.yml`) for local AI. Re-enable `playwright.yml` by restoring `on: push` / `pull_request` if needed.
