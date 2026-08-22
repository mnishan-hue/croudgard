import { serviceConfig } from './config';

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${serviceConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`CrowdGuard API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}