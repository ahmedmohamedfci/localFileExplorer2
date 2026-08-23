/** True when running inside the Tauri WebView (not plain browser / Vite). */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

const VITE_DEV_PORT = "1420";

/** True when the SPA is served from an EXE localhost host (not Vite / not Tauri). */
export function isBrowserHost(): boolean {
  if (typeof window === "undefined" || isTauri()) return false;
  const host = window.location.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  const port = window.location.port;
  // Vite dev server — not the EXE host.
  if (port === VITE_DEV_PORT) return false;
  // EXE host starts at 666 and bumps if another instance already took a port.
  if (!port) return false;
  const n = Number(port);
  return Number.isFinite(n) && n >= 666 && n < 666 + 32;
}

/** Default / fallback URL (first preferred port). Prefer api.getHostUrl() for the live port. */
export const BROWSER_HOST_URL = "http://127.0.0.1:666/";
