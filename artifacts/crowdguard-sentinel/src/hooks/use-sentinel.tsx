import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { getMockState, type Scenario } from '@/lib/sentinel';

const SentinelContext = createContext<{ scenario: Scenario; setScenario: (scenario: Scenario) => void } | null>(null);

export function SentinelProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<Scenario>('exitA');
  return <SentinelContext.Provider value={{ scenario, setScenario }}>{children}</SentinelContext.Provider>;
}

export function useSentinel() {
  const context = useContext(SentinelContext);
  if (!context) throw new Error('useSentinel must be used within SentinelProvider');
  const state = useMemo(() => getMockState(context.scenario), [context.scenario]);
  return { ...context, state };
}