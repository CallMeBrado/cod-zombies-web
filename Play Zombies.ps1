$ErrorActionPreference = 'Stop'
& node.exe (Join-Path $PSScriptRoot 'tools\play.mjs') @args
if ($LASTEXITCODE -ne 0) { throw 'The Zombies launcher failed. See local-data\server-error.log.' }
