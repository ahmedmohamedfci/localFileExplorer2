# Local File Explorer

Desktop app (Tauri 2 + React) for indexing and filtering personal video/audio libraries, then opening matches in MPC-HC / MPC-BE.

## Architecture

- **Rust (Tauri)**: SQLite catalog, recursive scan (incremental + deep), playlist write, open file/MPC, folder picker. Kept lean for startup and I/O.
- **JavaScript/React**: UI, pattern language (`+` AND, flexible substrings), live test filter, split-by-search grouping, formatting, settings orchestration.

On launch the results list stays empty until **Apply filter**. Temporary `playlist.mpcpl` is deleted at startup. Data lives in a `data/` folder next to the executable (or `LFE_DATA_DIR`).

## Develop

```powershell
.\run-dev.ps1
```

Close the app window or press Ctrl+C in that terminal — the script kills the Vite/npm/cargo process tree. To force-clean leftovers:

```powershell
.\stop-dev.ps1
```

Requires Rust stable and Visual Studio Build Tools (Windows).

## Build (standalone EXE)

```powershell
.\build-standalone.ps1
```

Output EXE:

`src-tauri\target\release\local-file-explorer.exe`

Copy that EXE wherever you want. By default settings live at `settings.json` next to the EXE; the catalog DB and playlist go under `data\` beside the EXE.

### Different settings per instance

Point each shortcut/copy at its own JSON:

```powershell
.\local-file-explorer.exe --settings D:\profiles\movies\settings.json
.\local-file-explorer.exe --settings D:\profiles\music\settings.json
```

Or use separate data folders (each gets its own `settings.json` + default DB):

```powershell
.\local-file-explorer.exe --data-dir D:\profiles\movies
.\local-file-explorer.exe --data-dir D:\profiles\music
```

Env alternatives: `LFE_SETTINGS`, `LFE_DATA_DIR`.

Put a distinct `databasePath` inside each settings JSON if catalogs should stay separate.

## CI

GitHub Actions (`.github/workflows/build-standalone.yml`) builds the Windows standalone EXE on push/PR to `main`/`v1` and on version tags (`v*` / `V*`). Download the artifact **`local-file-explorer-windows`** from the workflow run.
