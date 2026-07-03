# Thin wrapper — runs the cross-platform Node deploy script.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
node scripts/quick-deploy.mjs @args
