$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$env:TEMP = Join-Path $taskRoot '.cache\temp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $taskRoot '.cache\npm'
foreach ($taskRelative in @('.cache\temp','.cache\npm','.tools\oat','.tools\premake','local-data')) {
    New-Item -ItemType Directory -Path (Join-Path $taskRoot $taskRelative) -Force | Out-Null
}
$taskPremake = Join-Path $taskRoot '.tools\premake\premake5.exe'
if (-not (Test-Path -LiteralPath $taskPremake)) {
    $taskZip = Join-Path $taskRoot '.tools\premake\premake.zip'
    Invoke-WebRequest -Uri 'https://github.com/premake/premake-core/releases/download/v5.0.0-beta8/premake-5.0.0-beta8-windows.zip' -OutFile $taskZip
    Expand-Archive -LiteralPath $taskZip -DestinationPath (Split-Path -Parent $taskPremake) -Force
}
if ((Get-FileHash -LiteralPath $taskPremake -Algorithm SHA256).Hash -ne '2301E3E23FF3074CB83A5EA6103D68C7EA81DAD56B786807C84B0643CDDEA31B') {
    throw 'Premake checksum verification failed.'
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot '.tools\oat\ImageConverter.exe'))) {
    $taskOatZip = Join-Path $taskRoot '.tools\oat-windows.zip'
    Invoke-WebRequest -Uri 'https://github.com/Laupetin/OpenAssetTools/releases/download/v0.33.0/oat-windows.zip' -OutFile $taskOatZip
    Expand-Archive -LiteralPath $taskOatZip -DestinationPath (Join-Path $taskRoot '.tools\oat') -Force
}
$taskSource = Join-Path $taskRoot '.tools\oat-source'
if (-not (Test-Path -LiteralPath (Join-Path $taskSource '.git'))) {
    git clone --filter=blob:none --no-checkout https://github.com/Laupetin/OpenAssetTools.git $taskSource
    if ($LASTEXITCODE -ne 0) { throw 'OAT source clone failed.' }
    git -C $taskSource checkout --detach 59904a3e1dd698ce1c8b8e750d12b47e19cf83ba
    if ($LASTEXITCODE -ne 0) { throw 'Cannot check out the pinned OAT revision.' }
}
$taskPatch = Join-Path $taskRoot 'tools\oat-web-world.patch'
git -C $taskSource apply --reverse --check $taskPatch 2>$null
if ($LASTEXITCODE -ne 0) {
    git -C $taskSource apply --check $taskPatch
    if ($LASTEXITCODE -ne 0) { throw 'Exporter patch cannot be applied to this source tree.' }
    git -C $taskSource apply $taskPatch
    if ($LASTEXITCODE -ne 0) { throw 'Exporter patch application failed.' }
}
git -C $taskSource submodule update --init --depth 1 thirdparty/libtomcrypt thirdparty/libtommath thirdparty/zlib thirdparty/catch2 thirdparty/json thirdparty/eigen thirdparty/lz4 thirdparty/stb
if ($LASTEXITCODE -ne 0) { throw 'OAT dependency setup failed.' }
Push-Location $taskRoot
try {
    npm.cmd install --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Browser dependency installation failed.' }
} finally { Pop-Location }
Write-Output "Tool environment ready in $taskRoot"
