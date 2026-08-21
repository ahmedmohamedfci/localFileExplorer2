# Force-stop Local File Explorer and hanging tauri/vite/node processes for this project.
$ErrorActionPreference = "SilentlyContinue"

Write-Host "Stopping Local File Explorer processes…" -ForegroundColor Yellow

Get-Process -Name "local-file-explorer" | Stop-Process -Force

try {
    $conns = Get-NetTCPConnection -LocalPort 1420, 1421 -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        if ($c.OwningProcess -and $c.OwningProcess -ne 0) {
            Stop-Process -Id $c.OwningProcess -Force
        }
    }
} catch {}

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
        $_.CommandLine -and (
            $_.CommandLine -like "*localFileExplorer2*" -or
            ($_.CommandLine -like "*vite*" -and $_.CommandLine -like "*1420*")
        )
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Cargo/rustc left over from a killed tauri build for this repo
$project = "localFileExplorer2"
Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -match '^(cargo|rustc|tauri)\.exe$' -and
        $_.CommandLine -like "*$project*"
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host "Done." -ForegroundColor Green
