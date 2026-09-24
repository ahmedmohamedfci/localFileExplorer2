import { getCurrentWindow } from "@tauri-apps/api/window";
import packageJson from "../../package.json";
import { isTauri } from "./runtime";

const APP_TITLE = "Bulk File Explorer";
export const APP_VERSION = packageJson.version;

/** Build title: `audio (Bulk File Explorer v2.0.6)` or `Bulk File Explorer v2.0.6`. */
export function formatAppTitle(contextName?: string | null): string {
  const base = `${APP_TITLE} v${APP_VERSION}`;
  const name = contextName?.trim();
  return name ? `${name} (${base})` : base;
}

export function syncWindowTitle(contextName?: string | null): void {
  const title = formatAppTitle(contextName);
  document.title = title;
  if (!isTauri()) return;
  void getCurrentWindow()
    .setTitle(title)
    .catch((err) => {
      console.warn("Failed to set window title:", err);
    });
}
