import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import LiveControl from '@/pages/live-control';
import Cameras from '@/pages/cameras';
import Intelligence from '@/pages/intelligence';
import Hardware from '@/pages/hardware';
import Events from '@/pages/events';
import { SentinelProvider } from '@/hooks/use-sentinel';
import { SentinelShell } from '@/components/sentinel-shell';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <SentinelShell>
        <Switch>
          <Route path="/" component={LiveControl} />
          <Route path="/cameras" component={Cameras} />
          <Route path="/intelligence" component={Intelligence} />
          <Route path="/hardware" component={Hardware} />
          <Route path="/events" component={Events} />
          <Route component={NotFound} />
        </Switch>
      </SentinelShell>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SentinelProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </SentinelProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
