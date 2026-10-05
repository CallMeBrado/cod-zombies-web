$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$env:TEMP = Join-Path $taskProjectRoot '.cache\temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$taskVsWhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$taskVsRoot = & $taskVsWhere -latest -products '*' -version '[18.0,19.0)' -property installationPath
if (-not $taskVsRoot) { throw 'Visual Studio Build Tools 2026 is required for this exporter source.' }
$taskMSBuild = Join-Path $taskVsRoot 'MSBuild\Current\Bin\MSBuild.exe'
$taskSourceRoot = Join-Path $taskProjectRoot '.tools\oat-source'
$taskPremake = Join-Path $taskProjectRoot '.tools\premake\premake5.exe'
if (-not (Test-Path -LiteralPath $taskPremake)) { throw 'The local Premake binary is missing.' }
Push-Location $taskSourceRoot
try {
    & $taskPremake vs2026
    if ($LASTEXITCODE -ne 0) { throw 'Project generation failed.' }
    # Forward slashes: Windows PowerShell lets a trailing backslash escape the
    # quote it adds around this space-containing argument, corrupting SolutionDir.
    $taskSolutionProperty = '/p:SolutionDir=' + ((Join-Path $taskSourceRoot 'build') -replace '\\','/') + '/'
    foreach ($taskName in @('RawTemplater','ZoneCodeGenerator','ZoneCode','UnlinkerCli')) {
        & $taskMSBuild "build\src\$taskName\$taskName.vcxproj" /m:4 /p:Configuration=Release /p:Platform=Win32 $taskSolutionProperty /nologo /verbosity:minimal
        if ($LASTEXITCODE -ne 0) { throw "Exporter build failed in $taskName." }
    }
} finally { Pop-Location }
