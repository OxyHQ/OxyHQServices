import { Link, createFileRoute } from '@tanstack/react-router';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, ChartLineData02Icon } from '@hugeicons/core-free-icons';
import { useApplications } from '@/hooks/use-applications';

export const Route = createFileRoute('/_layout/usage')({
  component: UsagePage,
});

function UsagePage() {
  const { data: applications = [], isLoading } = useApplications();

  return (
    <div className="flex-1 bg-background">
      {/* Header */}
      <div className="px-6 py-6 border-b border-border">
        <h1 className="text-2xl font-semibold text-foreground">Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          API usage is tracked per application. Select an application to view its statistics.
        </p>
      </div>

      <div className="px-6 py-6">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton.Box key={i} width="100%" height={64} borderRadius={14} />
            ))}
          </div>
        ) : applications.length === 0 ? (
          <div className="py-12 text-center">
            <HugeiconsIcon
              icon={ChartLineData02Icon}
              size={48}
              className="text-muted-foreground mx-auto mb-4"
            />
            <p className="text-sm font-medium text-foreground mb-1">No applications yet</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Create an application to start tracking API usage.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {applications.map((app) => (
              <Link
                key={app._id}
                to="/apps/$appId/settings"
                params={{ appId: app._id }}
                className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{app.name}</p>
                  {app.description && (
                    <p className="text-sm text-muted-foreground line-clamp-1">{app.description}</p>
                  )}
                </div>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={16}
                  className="text-muted-foreground shrink-0"
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
