# Launch Local File Explorer (tauri dev) and clean up child processes on exit.
$ErrorActionPreference = "Continue"

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

function Stop-LfeDevProcesses {
    Write-Host "Stopping Local File Explorer / tauri dev processes…" -ForegroundColor Yellow

    Get-Process -Name "local-file-explorer" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    # Vite / npm children still bound to the Tauri dev port
    try {
        $conns = Get-NetTCPConnection -LocalPort 1420, 1421 -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            if ($c.OwningProcess -and $c.OwningProcess -ne 0) {
                Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}

    # Orphan node processes whose command line is this project's vite/tauri
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and (
                $_.CommandLine -like "*localFileExplorer2*" -or
                $_.CommandLine -like "*vite*" -and $_.CommandLine -like "*1420*"
            )
        } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

# Clean leftovers from previous runs first
Stop-LfeDevProcesses

$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npmCmd) { throw "npm not found on PATH" }
$npm = $npmCmd.Source

$proc = Start-Process -FilePath $npm -ArgumentList @("run", "tauri", "dev") `
    -WorkingDirectory $projectRoot `
    -PassThru -NoNewWindow

$rootPid = $proc.Id
Write-Host "tauri dev started (pid $rootPid). Close the app window or press Ctrl+C to stop." -ForegroundColor Cyan

try {
    Wait-Process -Id $rootPid
} finally {
    # Kill the whole process tree (npm → node → cargo → app)
    cmd /c "taskkill /PID $rootPid /T /F" 2>$null | Out-Null
    Stop-LfeDevProcesses
    Write-Host "Shutdown complete." -ForegroundColor Green
}
