import { useEffect, useRef } from 'react';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useAuth } from '@oxyhq/auth';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { Separator } from '@/components/ui/separator';
import { CommandMenuTrigger } from '@/components/command-menu';
import { SplashScreen } from '@/components/splash-screen';
import { SignInScreen } from '@/components/sign-in-screen';

export const Route = createFileRoute('/_layout')({
  component: LayoutComponent,
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isReady, signIn, lastSsoOutcome } = useAuth();
  const autoSignInTriedRef = useRef(false);

  // The central IdP had no session for the silent (prompt=none) SSO probe. The
  // RP must NOT re-bounce automatically — it defers to a user gesture below.
  const idpHadNoSession = lastSsoOutcome === 'none' || lastSsoOutcome === 'error';

  // Attempt automatic SSO exactly ONCE per tab: a single silent bounce to the
  // central IdP. `signIn({ interactive: false })` is itself loop-proof (it
  // refuses to re-navigate once a prior automatic probe this tab came back
  // none/error), so this ref is a belt-and-suspenders guard against redundant
  // calls within a mount. When the probe returns no session the branded
  // sign-in screen below takes over instead of the old infinite re-bounce.
  useEffect(() => {
    if (isReady && !isAuthenticated && !idpHadNoSession && !autoSignInTriedRef.current) {
      autoSignInTriedRef.current = true;
      void signIn({ interactive: false });
    }
  }, [isReady, isAuthenticated, idpHadNoSession, signIn]);

  if (isReady && !isAuthenticated && idpHadNoSession) {
    // A deliberate gesture: `signIn()` (default interactive) clears the
    // last-outcome and re-bounces to the IdP.
    return (
      <SignInScreen
        onSignIn={() => void signIn()}
        isError={lastSsoOutcome === 'error'}
      />
    );
  }

  if (!isReady || !isAuthenticated) {
    return <SplashScreen />;
  }

  return <>{children}</>;
}

function LayoutComponent() {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex flex-col h-screen">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <CommandMenuTrigger />
            <div className="flex-1" />
          </header>
          <main className="flex-1 flex flex-col overflow-auto">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
