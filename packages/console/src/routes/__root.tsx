import { Outlet, createRootRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WebOxyProvider } from '@oxyhq/auth';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { WorkspaceProvider } from '@/hooks/use-workspace';

import config from '@/lib/config';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
    },
    mutations: {
      retry: 1,
    },
  },
});

const TanStackRouterDevtools = lazy(() =>
  import('@tanstack/react-router-devtools').then((mod) => ({
    default: mod.TanStackRouterDevtools,
  }))
);

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <WebOxyProvider baseURL={config.oxyUrl}>
        <WorkspaceProvider>
          <TooltipProvider delayDuration={300}>
            <Outlet />
            <Toaster position="bottom-right" richColors closeButton />
          </TooltipProvider>
        </WorkspaceProvider>
      </WebOxyProvider>
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <TanStackRouterDevtools position="bottom-right" />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}
