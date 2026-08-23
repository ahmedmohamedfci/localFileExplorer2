# Local File Explorer

Desktop app (Tauri 2 + React) for indexing and filtering personal video/audio libraries, then opening matches in MPC-HC / MPC-BE.

## Architecture

- **Rust (Tauri)**: SQLite catalog, recursive scan (incremental + deep), playlist write, open file/MPC, folder picker. Kept lean for startup and I/O.
- **JavaScript/React**: UI, pattern language (`+` AND, flexible substrings), live test filter, split-by-search grouping, formatting, settings orchestration.

On launch the results list stays empty until **Apply filter**. Temporary playlist files are deleted at startup. Data lives beside the executable: `settings.json` next to the EXE, DB/playlist under `data/` (or `LFE_DATA_DIR` / `--settings` / `--data-dir`).

When the desktop app runs, it also starts a **browser host** on loopback (preferred port **666**; if that port is already taken by another instance, it uses **667**, **668**, …). Open that URL in Chrome for the same UI. A link appears in **Settings → Data & settings**. Use **Use desktop app settings** to bind the tab to this process’s `--settings` file.

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

Point each shortcut at its own JSON (`.json`, not `.exe`):

```powershell
.\local-file-explorer.exe --settings="D:\x\settings1.json"
.\local-file-explorer.exe --settings="D:\x\settings2.json"
```

Each process uses that settings file. Put a distinct `databasePath` in each JSON if catalogs should stay separate (e.g. `D:\x\db1.sqlite` and `D:\x\db2.sqlite`). Playlists are isolated per settings file name (`playlist-settings1.mpcpl`, …).

Each instance also starts its own browser host:

| Instance | Typical browser URL |
|----------|---------------------|
| First EXE | http://127.0.0.1:666/ |
| Second EXE | http://127.0.0.1:667/ |

Open the URL shown in that window’s **Settings → Data & settings**, then **Use desktop app settings** so the Chrome tab talks to that instance’s settings/DB.

Or use separate data folders (each gets its own `settings.json` + default DB):

```powershell
.\local-file-explorer.exe --data-dir D:\profiles\movies
.\local-file-explorer.exe --data-dir D:\profiles\music
```

Env alternatives: `LFE_SETTINGS`, `LFE_DATA_DIR`.

## CI

GitHub Actions (`.github/workflows/build-standalone.yml`) builds the Windows standalone EXE on push/PR to `main`/`v1` and on version tags (`v*` / `V*`). Download the artifact **`local-file-explorer-windows`** from the workflow run.
