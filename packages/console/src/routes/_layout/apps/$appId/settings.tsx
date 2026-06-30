import { createFileRoute, Link } from '@tanstack/react-router';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  Settings01Icon,
  Key01Icon,
  ChartLineData02Icon,
} from '@hugeicons/core-free-icons';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useApplication, useCallerAccess } from '@/hooks/use-applications';
import { GeneralSection } from '@/components/apps/general-section';
import { CredentialsSection } from '@/components/apps/credentials-section';
import { UsageSection } from '@/components/apps/usage-section';

export const Route = createFileRoute('/_layout/apps/$appId/settings')({
  component: AppSettingsPage,
});

function AppSettingsPage() {
  const { appId } = Route.useParams();
  const { data: application, isLoading, isError } = useApplication(appId);
  // Access derives from the caller's membership in the application's OWNING
  // account, embedded on the application response as `callerMembership`. Members
  // are managed at the account level (see Account settings), not per-app.
  const access = useCallerAccess(application);

  if (isLoading) {
    return (
      <div className="flex-1 bg-background flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (isError || !application) {
    return (
      <div className="flex-1 bg-background flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">This application could not be loaded.</p>
        <Link to="/apps" className="text-sm text-foreground underline underline-offset-4">
          Back to applications
        </Link>
      </div>
    );
  }

  const showCredentialsTab = access.can('credentials:read');
  const showUsageTab = access.can('apps:read');

  return (
    <ScrollArea className="flex-1 bg-background">
      {/* Header */}
      <div className="px-6 py-6 border-b border-border">
        <Link
          to="/apps"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          Back to applications
        </Link>
        <div className="flex items-center gap-3">
          <Avatar size="lg" className="rounded-lg after:rounded-lg">
            {application.icon && (
              <AvatarImage src={application.icon} alt={application.name} className="rounded-lg" />
            )}
            <AvatarFallback className="rounded-lg text-lg uppercase">
              {application.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">{application.name}</h1>
            {application.description && (
              <p className="text-sm text-muted-foreground mt-1">{application.description}</p>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <Tabs defaultValue="general" className="gap-6">
          <TabsList variant="line">
            <TabsTrigger value="general">
              <HugeiconsIcon icon={Settings01Icon} size={16} />
              General
            </TabsTrigger>
            {showCredentialsTab && (
              <TabsTrigger value="credentials">
                <HugeiconsIcon icon={Key01Icon} size={16} />
                Credentials
              </TabsTrigger>
            )}
            {showUsageTab && (
              <TabsTrigger value="usage">
                <HugeiconsIcon icon={ChartLineData02Icon} size={16} />
                Usage
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="general" className="max-w-2xl">
            <GeneralSection application={application} access={access} />
          </TabsContent>

          {showCredentialsTab && (
            <TabsContent value="credentials" className="max-w-3xl">
              <CredentialsSection application={application} access={access} />
            </TabsContent>
          )}

          {showUsageTab && (
            <TabsContent value="usage" className="max-w-3xl">
              <UsageSection application={application} access={access} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </ScrollArea>
  );
}
