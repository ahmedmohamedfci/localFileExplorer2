# Local File Explorer

Desktop app (Tauri 2 + React) for indexing and filtering personal video/audio libraries, then opening matches in MPC-HC / MPC-BE.

## How to open

**Desktop** — run the EXE (or a shortcut pointing at it).

**Browser** — while the desktop app is running, open the loopback host in Chrome. Preferred URL is [http://127.0.0.1:666/](http://127.0.0.1:666/); if that port is taken by another instance, it uses **667**, **668**, …. The live link appears in **Settings → Data & settings**. At the browser gate: drag-drop a settings JSON, or choose **Use desktop app settings** to bind the tab to that process’s settings/DB. Per-tab settings can also live in the URL hash (`#s=…`).

On launch the results list stays empty until **Apply filter**. Temporary playlist files are deleted at startup.

## Where data lives

By default, beside the EXE:

| Item | Location |
|------|----------|
| Settings | `settings.json` next to the EXE |
| Catalog DB + playlist | under `data\` beside the EXE |

### Different settings per instance

Point each shortcut at its own JSON (`.json`, not `.exe`):

```powershell
.\local-file-explorer.exe --settings="D:\x\settings1.json"
.\local-file-explorer.exe --settings D:\x\settings2.json
.\local-file-explorer.exe -s D:\x\settings2.json
```

Data folder is the parent of that JSON. Put a distinct `databasePath` in each file if catalogs should stay separate (e.g. `D:\x\db1.sqlite` and `D:\x\db2.sqlite`). Playlists are isolated per settings file name (`playlist-settings1.mpcpl`, …).

Each instance also starts its own browser host:

| Instance | Typical browser URL |
|----------|---------------------|
| First EXE | http://127.0.0.1:666/ |
| Second EXE | http://127.0.0.1:667/ |

Open the URL shown in that window’s **Settings → Data & settings**, then **Use desktop app settings** so the Chrome tab talks to that instance’s settings/DB.

Or use separate data folders (each gets its own `settings.json` + default DB):

```powershell
.\local-file-explorer.exe --data-dir="D:\profiles\movies"
.\local-file-explorer.exe --data-dir D:\profiles\music
.\local-file-explorer.exe -d D:\profiles\music
```

Env alternatives: `LFE_SETTINGS`, `LFE_DATA_DIR`.

The same “How to run & data layout” text is available in-app under **Settings** (collapsible section).

## Architecture

- **Rust (Tauri)**: SQLite catalog, recursive scan (incremental + deep), playlist write, open file/MPC, folder picker. Kept lean for startup and I/O.
- **JavaScript/React**: UI, pattern language (`+` AND, flexible substrings), live test filter, split-by-search grouping, formatting, settings orchestration.

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

## CI

GitHub Actions (`.github/workflows/build-standalone.yml`) builds the Windows standalone EXE on push/PR to `main`/`v1` and on version tags (`v*` / `V*`). Download the artifact **`local-file-explorer-windows`** from the workflow run.
