import { serviceConfig } from "./config";

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${serviceConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail ?? "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(
      detail ||
        `CrowdGuard could not complete this request (${response.status}).`,
    );
  }
  return response.json() as Promise<T>;
}
