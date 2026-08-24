import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SentinelProvider } from '@/hooks/use-sentinel';
import { SentinelShell } from '@/components/sentinel-shell';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const LiveControl=lazy(()=>import('@/pages/live-control'));
const Cameras=lazy(()=>import('@/pages/cameras'));
const CameraDetail=lazy(()=>import('@/pages/camera-detail'));
const Intelligence=lazy(()=>import('@/pages/intelligence'));
const Hardware=lazy(()=>import('@/pages/hardware'));
const Events=lazy(()=>import('@/pages/events'));
const FacilityConfiguration=lazy(()=>import('@/pages/facility'));
const NotFound=lazy(()=>import('@/pages/not-found'));
const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <SentinelShell>
        <Suspense fallback={<div className="panel grid min-h-64 place-items-center data-mono text-[10px] text-muted-foreground">LOADING OPERATIONS MODULE</div>}>
          <Switch>
            <Route path="/" component={LiveControl} />
            <Route path="/cameras/:cameraId" component={CameraDetail} />
            <Route path="/cameras" component={Cameras} />
            <Route path="/intelligence" component={Intelligence} />
            <Route path="/hardware" component={Hardware} />
            <Route path="/events" component={Events} />
            <Route path="/facility" component={FacilityConfiguration} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
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
