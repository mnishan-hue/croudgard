import { getMockSnapshot } from '@/data/mockData';
import type { CameraStatus, Scenario } from '@/types/sentinel';
import { serviceConfig } from './config';
import { apiFetch } from './api';

export async function getCameraStatuses(
  scenario: Scenario,
): Promise<CameraStatus[]> {
  if (serviceConfig.useMockData) return getMockSnapshot(scenario).cameras;
  return apiFetch<CameraStatus[]>('/cameras');
}