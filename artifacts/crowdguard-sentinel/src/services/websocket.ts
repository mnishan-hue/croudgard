import { serviceConfig } from "./config";

export type SentinelMessageHandler<T> = (message: T) => void;
export type SocketStatus = "connecting" | "open" | "closed" | "error";

export function connectSentinelSocket<T>(
  onMessage: SentinelMessageHandler<T>,
  onStatus?: (status: SocketStatus) => void,
): () => void {
  if (!serviceConfig.websocketUrl) {
    onStatus?.("closed");
    return () => undefined;
  }

  let socket: WebSocket | undefined;
  let retry: number | undefined;
  let stopped = false;
  let attempt = 0;

  const scheduleReconnect = () => {
    if (stopped || retry !== undefined) return;
    const delay = Math.min(10_000, 500 * 2 ** attempt);
    retry = window.setTimeout(() => {
      retry = undefined;
      connect();
    }, delay);
    attempt += 1;
  };

  const connect = () => {
    if (stopped || socket) return;
    onStatus?.("connecting");
    socket = new WebSocket(serviceConfig.websocketUrl);
    socket.onopen = () => {
      attempt = 0;
      onStatus?.("open");
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as T);
      } catch {
        // Ignore one malformed payload without poisoning a healthy socket.
      }
    };
    socket.onerror = () => {
      onStatus?.("error");
      socket?.close();
    };
    socket.onclose = () => {
      socket = undefined;
      if (stopped) return;
      onStatus?.("closed");
      scheduleReconnect();
    };
  };

  const reconnectNow = () => {
    if (stopped || socket) return;
    if (retry !== undefined) window.clearTimeout(retry);
    retry = undefined;
    attempt = 0;
    connect();
  };

  window.addEventListener("online", reconnectNow);
  connect();
  return () => {
    stopped = true;
    window.removeEventListener("online", reconnectNow);
    if (retry !== undefined) window.clearTimeout(retry);
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = undefined;
    }
  };
}
