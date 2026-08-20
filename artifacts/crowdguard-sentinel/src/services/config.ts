export const serviceConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
  websocketUrl: import.meta.env.VITE_WS_URL ?? '',
  useMockData: import.meta.env.VITE_USE_MOCK_DATA !== 'false',
} as const;