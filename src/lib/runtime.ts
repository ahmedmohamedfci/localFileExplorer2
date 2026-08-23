/** True when running inside the Tauri WebView (not plain browser / Vite). */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** True when the SPA is served from the EXE's localhost host (port 666). */
export function isBrowserHost(): boolean {
  if (typeof window === "undefined") return false;
  const port = window.location.port;
  return port === "666" || window.location.href.includes(":666/");
}

export const BROWSER_HOST_URL = "http://127.0.0.1:666/";
