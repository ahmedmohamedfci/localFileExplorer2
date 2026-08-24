import { getCurrentWindow } from "@tauri-apps/api/window";
import packageJson from "../../package.json";
import { isTauri } from "./runtime";

const APP_TITLE = "Local File Explorer";
export const APP_VERSION = packageJson.version;

export function syncWindowTitle(settingsPath?: string | null): void {
  const path = settingsPath?.trim();
  const base = `${APP_TITLE} v${APP_VERSION}`;
  const title = path ? `${base} — ${path}` : base;
  document.title = title;
  if (!isTauri()) return;
  void getCurrentWindow()
    .setTitle(title)
    .catch((err) => {
      console.warn("Failed to set window title:", err);
    });
}
