import { getMockSnapshot } from '@/data/mockData';
import type { Scenario, SentinelSnapshot } from '@/types/sentinel';
import { serviceConfig } from './config';
import { apiFetch } from './api';

export async function getCrowdSnapshot(
  scenario: Scenario,
): Promise<SentinelSnapshot> {
  if (serviceConfig.useMockData) return getMockSnapshot(scenario);
  return apiFetch<SentinelSnapshot>('/crowd/snapshot');
}