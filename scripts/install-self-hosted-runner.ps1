# Install GitHub Actions self-hosted runner for DuongPhanHoai/pw-ts-sample (Windows x64)
#
# Usage (PowerShell as Administrator recommended for service install):
#   cd D:\Testing\pw-ts-sample
#   .\scripts\install-self-hosted-runner.ps1
#
# Registration token (expires ~1 hour):
#   https://github.com/DuongPhanHoai/pw-ts-sample/settings/actions/runners/new?arch=x64&os=win

param(
  [string]$RunnerRoot = "C:\actions-runner\pw-ts-sample",
  [string]$RepoUrl = "https://github.com/DuongPhanHoai/pw-ts-sample",
  [string]$RunnerName = $env:COMPUTERNAME,
  [string]$Token,
  [switch]$InstallService,
  [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"

Write-Host "=== GitHub self-hosted runner installer ===" -ForegroundColor Cyan
Write-Host "Repo:   $RepoUrl"
Write-Host "Folder: $RunnerRoot"
Write-Host "Name:   $RunnerName"
Write-Host ""
Write-Host "Get token: $RepoUrl/settings/actions/runners/new?arch=x64&os=win" -ForegroundColor Yellow
Write-Host ""

if (-not $Token) {
  $Token = Read-Host "Paste runner registration token from GitHub"
}
if (-not $Token) {
  throw "Registration token is required."
}

# Runner tokens come from Settings → Actions → Runners → New (short-lived, ~1 hour).
# PATs (ghp_...) and fine-grained tokens (github_pat_...) do NOT work here.
if ($Token -match '^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)') {
  throw @"
Wrong token type: this looks like a Personal Access Token (ghp_...).

Do NOT use a PAT for runner registration.

Get the correct token:
  1. Open: $RepoUrl/settings/actions/runners/new?arch=x64&os=win
  2. Scroll to the Configure section
  3. Copy the token shown after --token in the config.cmd example
     (usually starts with A... or similar — NOT ghp_)

If you pasted a PAT in chat or elsewhere, revoke it now:
  GitHub → Settings → Developer settings → Personal access tokens
"@
}

New-Item -Path $RunnerRoot -ItemType Directory -Force | Out-Null
Set-Location $RunnerRoot

if (-not $SkipDownload) {
  Write-Host "Fetching latest actions/runner release..." -ForegroundColor Yellow
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/actions/runner/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -eq "actions-runner-win-x64-$($release.tag_name.Substring(1)).zip" }
  if (-not $asset) {
    $asset = $release.assets | Where-Object { $_.name -like "actions-runner-win-x64-*.zip" } | Select-Object -First 1
  }
  if (-not $asset) {
    throw "Could not find Windows x64 runner asset in latest release."
  }

  $zipName = $asset.name
  Write-Host "Downloading $zipName ..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipName
  Write-Host "Extracting..."
  Expand-Archive -Path $zipName -Force -DestinationPath .
}

if (-not (Test-Path ".\config.cmd")) {
  throw "config.cmd not found in $RunnerRoot. Download may have failed."
}

Write-Host "Configuring runner..." -ForegroundColor Yellow
$configArgs = @(
  "--url", $RepoUrl,
  "--token", $Token,
  "--name", $RunnerName,
  "--labels", "self-hosted,Windows,X64,pw-ts-sample",
  "--unattended",
  "--replace"
)

if ($InstallService) {
  $configArgs += "--runasservice"
}

& .\config.cmd @configArgs
if ($LASTEXITCODE -ne 0) {
  throw "config.cmd failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Runner registered successfully." -ForegroundColor Green

if ($InstallService) {
  Write-Host "Starting Windows service..." -ForegroundColor Yellow
  & .\svc.cmd start
  Get-Service "actions.runner.*" | Format-Table -AutoSize
  Write-Host "Service installed. Runner will start on boot." -ForegroundColor Green
} else {
  Write-Host @"

Next steps (choose one):

  A) Interactive (recommended first time — LM Studio uses your user session):
     cd $RunnerRoot
     .\run.cmd

  B) Install as Windows service (run this script again with -InstallService as Admin):
     .\scripts\install-self-hosted-runner.ps1 -Token <token> -SkipDownload -InstallService

Verify online:
  $RepoUrl/settings/actions/runners

Configure repo Variables (LM Studio):
  LMSTUDIO_BASE_URL = http://192.168.1.166:1234/v1
  LMSTUDIO_MODEL    = google/gemma-4-e4b

Full guide: docs/SELF-HOSTED-RUNNER.md
"@ -ForegroundColor Cyan
}
