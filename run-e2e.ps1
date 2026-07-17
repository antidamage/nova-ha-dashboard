#!/usr/bin/env pwsh
#
# Run the Nova HA Dashboard Playwright end-to-end suite.
#
# The suite drives the dashboard in demo mode (NEXT_PUBLIC_NOVA_DEMO_MODE=true),
# so it talks only to the nova-dummy-data-provider fixtures - no Home Assistant,
# camera, or personal data is touched. Playwright starts both servers itself
# (the dummy data provider and `next dev` in demo mode) via playwright.config.ts.
#
# Usage:
#   ./run-e2e.ps1                 # run the whole suite headless
#   ./run-e2e.ps1 --headed        # watch it run in a browser
#   ./run-e2e.ps1 --ui            # open the Playwright UI runner
#   ./run-e2e.ps1 e2e/tasks.spec.ts -g "dismisses"   # filter
# Any extra arguments are forwarded to `playwright test`.

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path "node_modules/@playwright/test")) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm install
}

# Ensure the Chromium build Playwright expects is present.
$probe = & node -e "try{require('@playwright/test').chromium.executablePath();process.exit(require('fs').existsSync(require('@playwright/test').chromium.executablePath())?0:1)}catch(e){process.exit(1)}" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing the Chromium browser for Playwright..." -ForegroundColor Cyan
    & "node_modules/.bin/playwright" install chromium
}

& "node_modules/.bin/playwright" test @args
exit $LASTEXITCODE
