# Create a branch + PR for AI auto-healed test changes (CI or local with GH_TOKEN).
$ErrorActionPreference = "Stop"

$autoFix = if ($env:AUTO_FIX_TESTS) { $env:AUTO_FIX_TESTS.ToLower() } else { "false" }
if ($autoFix -ne "true") {
  Write-Host "AUTO_FIX_TESTS=$autoFix — skip PR (set true to commit fixes)."
  exit 0
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is required."
}

$ghAvailable = $null -ne (Get-Command gh -ErrorAction SilentlyContinue)
if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
  if ($ghAvailable) {
    Write-Error "GH_TOKEN or GITHUB_TOKEN is required for gh pr create."
  }
  Write-Error "GH_TOKEN (or GITHUB_TOKEN) is required. On GitHub Actions this is set automatically."
}

if ($env:GITHUB_TOKEN -and -not $env:GH_TOKEN) {
  $env:GH_TOKEN = $env:GITHUB_TOKEN
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Read-AuditSummary {
  $auditPath = Join-Path $Root "reports\auto-fix-audit.json"
  if (-not (Test-Path $auditPath)) { return @() }
  try {
    $audit = Get-Content $auditPath -Raw | ConvertFrom-Json
    if ($audit -isnot [Array]) { return @($audit) }
    return @($audit | Where-Object { $_.action -eq "applied" })
  } catch {
    return @()
  }
}

$applied = Read-AuditSummary
$changedTests = git status --porcelain -- tests/ 2>$null
if (-not $changedTests) {
  Write-Host "No changes under tests/ — nothing to PR."
  exit 0
}

Write-Host "Test file changes:"
Write-Host $changedTests

$runId = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { "local-" + (Get-Date -Format "yyyyMMdd-HHmmss") }
$attempt = if ($env:GITHUB_RUN_ATTEMPT) { $env:GITHUB_RUN_ATTEMPT } else { "1" }
$branch = "ai-fix/run-$runId-$attempt"

$baseBranch = $env:GITHUB_BASE_REF
if (-not $baseBranch) {
  $baseBranch = $env:GITHUB_REF_NAME
}
if (-not $baseBranch) {
  $baseBranch = (git rev-parse --abbrev-ref HEAD 2>$null)
}
if ($baseBranch -eq "HEAD" -or $branch -eq $baseBranch) {
  $baseBranch = "main"
}

$fileList = ($changedTests -split "`n" | ForEach-Object { ($_ -replace '^\S+\s+', '').Trim() } | Where-Object { $_ })
$summaryLines = @()
foreach ($entry in $applied) {
  if ($entry.filePath) {
    $summaryLines += "- $($entry.filePath) ($($entry.testName))"
  }
}
if ($summaryLines.Count -eq 0) {
  foreach ($f in $fileList) { $summaryLines += "- $f" }
}

$commitBody = @(
  "Automated test fixes from Playwright AI auto-heal.",
  "",
  "Run: $runId (attempt $attempt)",
  "Workflow: $(if ($env:GITHUB_WORKFLOW) { $env:GITHUB_WORKFLOW } else { 'local' })",
  "",
  "Changed files:",
  ($summaryLines -join "`n")
) -join "`n"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git checkout -b $branch
git add tests/
git commit -m "fix(tests): AI auto-heal from Playwright run $runId" -m $commitBody

$remote = "origin"
git push -u $remote $branch

$prTitle = "fix(tests): AI auto-heal (run $runId)"
$prBody = @(
  "## Summary",
  "AI auto-heal applied Playwright test fixes after a failed run.",
  "",
  "### Changed files",
  ($summaryLines -join "`n"),
  "",
  "### Context",
  "- **Run ID:** $runId",
  "- **Attempt:** $attempt",
  "- **TEST_ENV:** $(if ($env:TEST_ENV) { $env:TEST_ENV } else { 'n/a' })",
  "",
  "Review diffs and merge if fixes look correct. Re-run Playwright CI on this branch before merging.",
  "",
  "Reports are attached to the workflow artifact ``reports`` on the triggering run."
) -join "`n"

if ($env:GITHUB_ACTIONS -eq "true") {
  $token = if ($env:GH_TOKEN) { $env:GH_TOKEN } else { $env:GITHUB_TOKEN }
  $repo = $env:GITHUB_REPOSITORY
  $owner = ($repo -split "/")[0]
  $headers = @{
    Authorization = "Bearer $token"
    Accept        = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
  $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/pulls?head=${owner}:$branch&state=open" -Headers $headers -Method Get
  if ($existing -and $existing.Count -gt 0) {
    Write-Host "PR already exists: #$($existing[0].number) $($existing[0].html_url)"
    exit 0
  }
  $created = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/pulls" -Headers $headers -Method Post -Body (@{
    title = $prTitle; head = $branch; base = $baseBranch; body = $prBody
  } | ConvertTo-Json -Depth 4) -ContentType "application/json; charset=utf-8"
  Write-Host "Pull request created: #$($created.number) $($created.html_url)"
  exit 0
}

if (-not $ghAvailable) {
  Write-Warning "Branch pushed: $branch — install GitHub CLI (gh) to open a PR automatically."
  exit 0
}

$existing = gh pr list --head $branch --json number --jq ".[0].number" 2>$null
if ($existing) {
  Write-Host "PR already exists: #$existing"
  gh pr view $existing --web 2>$null
  exit 0
}

gh pr create `
  --base $baseBranch `
  --head $branch `
  --title $prTitle `
  --body $prBody

Write-Host "Pull request created for branch $branch (base: $baseBranch)."
