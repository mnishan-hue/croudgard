const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(
  /\/$/,
  "",
);

function websocketFromApi(apiBase: string) {
  if (!/^https?:\/\//i.test(apiBase)) return null;
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/api\/?$/, "")}/ws/live`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

const websocketUrl =
  import.meta.env.VITE_WS_URL ??
  websocketFromApi(apiBaseUrl) ??
  (import.meta.env.DEV
    ? "ws://localhost:8000/ws/live"
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/live`);

export const serviceConfig = {
  apiBaseUrl,
  websocketUrl,
  backendOrigin: /^https?:\/\//i.test(apiBaseUrl)
    ? new URL(apiBaseUrl).origin
    : window.location.origin,
} as const;
