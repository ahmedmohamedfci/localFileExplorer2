import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./runtime";

const APP_TITLE = "Local File Explorer";

export function syncWindowTitle(settingsPath?: string | null): void {
  const path = settingsPath?.trim();
  const title = path ? `${APP_TITLE} — ${path}` : APP_TITLE;
  document.title = title;
  if (isTauri()) {
    void getCurrentWindow().setTitle(title);
  }
}
