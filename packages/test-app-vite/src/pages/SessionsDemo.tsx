import { useAuth, useSessions, useUserDevices, useSwitchSession, useLogoutSession, useLogoutAll } from "@oxyhq/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"

export function SessionsDemo() {
  const { isAuthenticated, activeSessionId } = useAuth()
  const { data: sessions, isLoading: sessionsLoading } = useSessions()
  const { data: devices, isLoading: devicesLoading } = useUserDevices()
  const switchSession = useSwitchSession()
  const logoutSession = useLogoutSession()
  const logoutAll = useLogoutAll()

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Sign in to view sessions and devices.
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleSwitch = async (sessionId: string) => {
    try {
      await switchSession.mutateAsync(sessionId)
      toast.success("Switched session")
    } catch (err) {
      toast.error("Failed to switch: " + String(err))
    }
  }

  const handleLogoutSession = async (sessionId: string) => {
    try {
      await logoutSession.mutateAsync(sessionId)
      toast.success("Session logged out")
    } catch (err) {
      toast.error("Failed to logout session: " + String(err))
    }
  }

  const handleLogoutAll = async () => {
    try {
      await logoutAll.mutateAsync()
      toast.success("All sessions logged out")
    } catch (err) {
      toast.error("Failed to logout all: " + String(err))
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Active Sessions */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Active Sessions</CardTitle>
            <CardDescription>Manage sessions via useSessions()</CardDescription>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleLogoutAll}
            disabled={logoutAll.isPending}
          >
            {logoutAll.isPending ? "Logging out..." : "Logout All"}
          </Button>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : sessions && sessions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session: any) => (
                  <TableRow key={session.sessionId || session._id}>
                    <TableCell className="font-mono text-xs">
                      {(session.sessionId || session._id || "").substring(0, 12)}...
                    </TableCell>
                    <TableCell>
                      {(session.sessionId || session._id) === activeSessionId ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {session.createdAt ? new Date(session.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {(session.sessionId || session._id) !== activeSessionId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSwitch(session.sessionId || session._id)}
                            disabled={switchSession.isPending}
                          >
                            Switch
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleLogoutSession(session.sessionId || session._id)}
                          disabled={logoutSession.isPending}
                        >
                          Logout
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No sessions found</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Devices */}
      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
          <CardDescription>Registered devices via useUserDevices()</CardDescription>
        </CardHeader>
        <CardContent>
          {devicesLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : devices && Array.isArray(devices) && devices.length > 0 ? (
            <div className="space-y-3">
              {(devices as any[]).map((device: any) => (
                <div
                  key={device._id || device.deviceId}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{device.name || device.deviceName || "Unknown Device"}</p>
                    <p className="text-xs text-muted-foreground">
                      {device.platform || device.os || "Unknown platform"}
                      {device.lastActive && ` · Last active ${new Date(device.lastActive).toLocaleDateString()}`}
                    </p>
                  </div>
                  <Badge variant="outline">{device.type || "device"}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No devices found</p>
          )}
        </CardContent>
      </Card>

      {/* Code Example */}
      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-md bg-muted p-4 text-xs">
{`import { useSessions, useSwitchSession, useLogoutAll } from '@oxyhq/auth';

function Sessions() {
  const { data: sessions } = useSessions();
  const switchSession = useSwitchSession();
  const logoutAll = useLogoutAll();

  await switchSession.mutateAsync(sessionId);
  await logoutAll.mutateAsync();
}`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
