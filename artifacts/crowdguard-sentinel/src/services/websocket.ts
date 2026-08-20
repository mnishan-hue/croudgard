import { serviceConfig } from './config';

export type SentinelMessageHandler<T> = (message: T) => void;

export function connectSentinelSocket<T>(
  onMessage: SentinelMessageHandler<T>,
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void,
): () => void {
  if (serviceConfig.useMockData || !serviceConfig.websocketUrl) {
    onStatus?.('closed');
    return () => undefined;
  }

  onStatus?.('connecting');
  const socket = new WebSocket(serviceConfig.websocketUrl);
  socket.onopen = () => onStatus?.('open');
  socket.onmessage = (event) => onMessage(JSON.parse(event.data) as T);
  socket.onerror = () => onStatus?.('error');
  socket.onclose = () => onStatus?.('closed');
  return () => socket.close();
}