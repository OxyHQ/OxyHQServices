import { createFileRoute, Link } from '@tanstack/react-router';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  Settings01Icon,
  UserMultiple02Icon,
  Key01Icon,
  ChartLineData02Icon,
} from '@hugeicons/core-free-icons';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import {
  useApplication,
  useApplicationMembers,
  useCallerAccess,
} from '@/hooks/use-applications';
import { GeneralSection } from '@/components/apps/general-section';
import { MembersSection } from '@/components/apps/members-section';
import { CredentialsSection } from '@/components/apps/credentials-section';
import { UsageSection } from '@/components/apps/usage-section';

export const Route = createFileRoute('/_layout/apps/$appId/settings')({
  component: AppSettingsPage,
});

function AppSettingsPage() {
  const { appId } = Route.useParams();
  const { data: application, isLoading, isError } = useApplication(appId);
  // Members are also used as a fallback source for the caller's own access when
  // the API does not embed `callerMembership`; the request is authorized
  // server-side, so it is safe to issue here.
  const { data: members } = useApplicationMembers(appId);
  const access = useCallerAccess(application, members);

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

  const showMembersTab = access.can('members:read');
  const showCredentialsTab = access.can('credentials:read');
  const showUsageTab = access.can('usage:read');

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
        <h1 className="text-2xl font-semibold text-foreground">{application.name}</h1>
        {application.description && (
          <p className="text-sm text-muted-foreground mt-1">{application.description}</p>
        )}
      </div>

      <div className="px-6 py-6">
        <Tabs defaultValue="general" className="gap-6">
          <TabsList variant="line">
            <TabsTrigger value="general">
              <HugeiconsIcon icon={Settings01Icon} size={16} />
              General
            </TabsTrigger>
            {showMembersTab && (
              <TabsTrigger value="members">
                <HugeiconsIcon icon={UserMultiple02Icon} size={16} />
                Members
              </TabsTrigger>
            )}
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

          {showMembersTab && (
            <TabsContent value="members" className="max-w-3xl">
              <MembersSection application={application} access={access} />
            </TabsContent>
          )}

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
