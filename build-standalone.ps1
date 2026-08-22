# Build a standalone release EXE (no installer required).
$ErrorActionPreference = "Stop"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vs) {
        Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
        Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64" | Out-Null
    }
}

$env:CARGO_TARGET_DIR = Join-Path $projectRoot "src-tauri\target"

Write-Host "Building standalone release…" -ForegroundColor Cyan
npm run tauri -- build --no-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $projectRoot "src-tauri\target\release\local-file-explorer.exe"
if (-not (Test-Path $exe)) {
    throw "Build finished but EXE not found at $exe"
}

Write-Host ""
Write-Host "Standalone EXE:" -ForegroundColor Green
Write-Host "  $exe"
Write-Host ""
Write-Host "Examples:" -ForegroundColor Cyan
Write-Host "  & `"$exe`" --settings D:\profiles\movies\settings.json"
Write-Host "  & `"$exe`" --data-dir D:\profiles\music"
