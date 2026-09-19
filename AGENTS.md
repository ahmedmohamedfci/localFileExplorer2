# Local File Explorer (`localFileExplorer2`)

Desktop app for indexing personal video/audio libraries, filtering by pattern language, and opening matches in MPC-HC / MPC-BE.

## Maturity

**Beta · side project.** Personal tooling — **not production-ready** or packaged as a polished consumer product.

## Stack

- Tauri 2 + React + Vite (UI)
- Rust backend: SQLite catalog, recursive scan (incremental + deep), playlist write, MPC open, folder picker
- Node ≥ 22; Windows needs Rust stable + Visual Studio Build Tools

## Architecture split

- **Rust (`src-tauri`)** — I/O, DB, OS integration (keep lean)
- **React (`src`)** — pattern language (`+` = AND, flexible substrings), live filter test, split-by-search grouping, settings UI

Results stay empty until **Apply filter**. Temp `playlist.mpcpl` is deleted at startup. Data defaults to a `data/` folder next to the executable (override with `LFE_DATA_DIR` / `--data-dir`).

## How to run

```powershell
.\run-dev.ps1
```

Stop cleanly with Ctrl+C or close the window; leftovers: `.\stop-dev.ps1`.

Standalone EXE:

```powershell
.\build-standalone.ps1
# → src-tauri\target\release\local-file-explorer.exe
```

Per-instance profiles: `--settings path\to\settings.json` or `--data-dir path\to\profile` (also `LFE_SETTINGS`, `LFE_DATA_DIR`).

## Important paths

- `src/` — React UI
- `src-tauri/` — Rust / Tauri
- `run-dev.ps1`, `stop-dev.ps1`, `build-standalone.ps1`
- `.github/workflows/build-standalone.yml` — Windows EXE artifact `local-file-explorer-windows`

## Pitfalls

- Do not expect a populated results list on launch — user must apply a filter.
- Keep heavy I/O in Rust; avoid bloating the frontend process.
- Multiple copies of the EXE need separate settings/data dirs if catalogs should not collide.
- GitHub: `ahmedmohamedfci/localFileExplorer2`.
