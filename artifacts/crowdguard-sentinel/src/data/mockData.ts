import { getMockState, type Scenario } from '@/lib/sentinel';
import type { SentinelSnapshot } from '@/types/sentinel';

export function getMockSnapshot(scenario: Scenario): SentinelSnapshot {
  const state = getMockState(scenario);
  return {
    timestamp: state.system.timestamp,
    systemState: state.system.systemState,
    system: state.system,
    cameras: state.cameras,
    zones: state.zones,
    analysis: state.analysis,
    predictions: state.predictions,
    robot: state.robot,
    events: state.events,
    explanations: state.explanations,
  };
}