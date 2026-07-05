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
  const { isAuthenticated, isReady, signIn } = useAuth();

  // The SDK cold boot resolves the device session silently (no redirect). While
  // it runs, show the splash; once resolved and signed out, render the branded
  // sign-in screen whose button opens the in-app "Sign in with Oxy" modal
  // (`signIn()` — modal only, never a navigation).
  if (!isReady) {
    return <SplashScreen />;
  }

  if (!isAuthenticated) {
    return <SignInScreen onSignIn={signIn} />;
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
