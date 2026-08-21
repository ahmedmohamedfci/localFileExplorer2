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

## Build

```bash
npm run tauri build
```
