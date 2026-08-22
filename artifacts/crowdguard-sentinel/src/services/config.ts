export const serviceConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
  websocketUrl: import.meta.env.VITE_WS_URL ?? (import.meta.env.DEV ? 'ws://localhost:8000/ws/live' : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/live`),
  useMockData: import.meta.env.VITE_USE_MOCK_DATA === 'true',
} as const;
