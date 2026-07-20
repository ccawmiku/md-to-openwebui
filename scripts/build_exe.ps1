param(
    [string]$Python = "python",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $projectRoot "dist"
}

$staticPath = Join-Path $projectRoot "src\md_to_openwebui\static"
$launcherPath = Join-Path $projectRoot "scripts\launcher.py"
$versionPath = Join-Path $projectRoot "scripts\version_info.txt"
$workPath = Join-Path $projectRoot "build\pyinstaller"
$specPath = Join-Path $projectRoot "build\pyinstaller-spec"

& $Python -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name "md-to-openwebui" `
    --version-file $versionPath `
    --add-data "$staticPath;md_to_openwebui/static" `
    --distpath $OutputDir `
    --workpath $workPath `
    --specpath $specPath `
    $launcherPath

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller build failed with exit code $LASTEXITCODE"
}

$exePath = Join-Path $OutputDir "md-to-openwebui.exe"
if (-not (Test-Path -LiteralPath $exePath)) {
    throw "Expected executable was not created: $exePath"
}

Write-Output $exePath
