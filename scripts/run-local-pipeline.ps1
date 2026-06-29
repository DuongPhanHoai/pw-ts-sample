# Local pipeline: tests → AI analysis → optional auto-heal
param(
  [ValidateSet('false', 'dry-run', 'true')]
  [string]$AutoFixTests = $env:AUTO_FIX_TESTS,
  [string]$TestEnv = $env:TEST_ENV
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $AutoFixTests) { $AutoFixTests = "false" }
if (-not $TestEnv) { $TestEnv = "dev" }

$env:AUTO_FIX_TESTS = $AutoFixTests
$env:TEST_ENV = $TestEnv

if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      $name = $matches[1].Trim()
      $value = $matches[2].Trim()
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

Write-Host "=== Playwright + Local AI Pipeline ===" -ForegroundColor Cyan
Write-Host "TEST_ENV=$TestEnv"
Write-Host "AUTO_FIX_TESTS=$AutoFixTests"

Write-Host "`n[1/3] Running Playwright tests..." -ForegroundColor Yellow
npm test
$testExit = $LASTEXITCODE

Write-Host "`n[2/3] AI analysis..." -ForegroundColor Yellow
npm run analyze:results
$analyzeExit = $LASTEXITCODE

Write-Host "`n[3/3] Apply AI fixes..." -ForegroundColor Yellow
npm run apply:ai-fixes
$fixExit = $LASTEXITCODE

if ($AutoFixTests -eq "true" -and $testExit -ne 0) {
  Write-Host "`nRe-running failed tests..." -ForegroundColor Yellow
  npx playwright test --last-failed
}

Write-Host "`nReports: reports/ai-test-report.md, reports/ai-test-report.json" -ForegroundColor Cyan
if ($testExit -ne 0 -and $AutoFixTests -eq "false") { exit 1 }
exit 0
