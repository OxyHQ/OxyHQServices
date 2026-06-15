import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuth } from '@oxyhq/auth';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  Delete02Icon,
  Add01Icon,
  UserMultiple02Icon,
  Mail01Icon,
  Cancel01Icon,
  CrownIcon,
} from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ImageUploadField } from '@/components/ui/image-upload-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useWorkspace,
  useWorkspaceMembers,
  useInviteWorkspaceMember,
  useUpdateWorkspaceMember,
  useRemoveWorkspaceMember,
  type WorkspaceRole,
  type WorkspaceMember,
  type AssignableWorkspaceRole,
} from '@/hooks/use-workspace';
import { toast } from 'sonner';
import {
  getErrorMessage,
  isUserNotFoundError,
  USER_NOT_FOUND_MESSAGE,
} from '@/lib/api-error';

export const Route = createFileRoute('/_layout/settings/workspace')({
  component: WorkspaceSettingsPage,
});

const roleLabels: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

const roleDescriptions: Record<AssignableWorkspaceRole, string> = {
  admin: 'Can manage members and settings',
  member: 'Can create apps and API keys',
  viewer: 'Read-only access',
};

const ASSIGNABLE_ROLES: AssignableWorkspaceRole[] = ['admin', 'member', 'viewer'];

/** Short, readable handle for a member identified only by user id. */
function shortUserId(userId: string): string {
  return userId.length > 10 ? `${userId.slice(0, 6)}…${userId.slice(-4)}` : userId;
}

function WorkspaceSettingsPage() {
  const { oxyServices } = useAuth();
  const {
    currentWorkspace,
    updateWorkspace,
    deleteWorkspace,
    canEditWorkspace,
    canManageMembers,
    canDeleteWorkspace,
  } = useWorkspace();

  const workspaceId = currentWorkspace?._id;
  const isPersonal = currentWorkspace?.type === 'personal';

  // Members are fetched only for team workspaces with permission to read them.
  const canManage = currentWorkspace ? canManageMembers(currentWorkspace) : false;
  const membersQuery = useWorkspaceMembers(workspaceId, !!currentWorkspace && !isPersonal);
  const members = membersQuery.data ?? [];
  const activeMembers = members.filter((m) => m.status === 'active');
  const pendingInvites = members.filter((m) => m.status === 'invited');
  const ownerCount = activeMembers.filter((m) => m.role === 'owner').length;

  const inviteMemberMutation = useInviteWorkspaceMember();
  const updateMemberMutation = useUpdateWorkspaceMember();
  const removeMemberMutation = useRemoveWorkspaceMember();

  // General form — seeded from the current workspace via lazy initializers so
  // the inputs stay editable without an effect resetting them on every render.
  const [name, setName] = useState(() => currentWorkspace?.name ?? '');
  const [description, setDescription] = useState(() => currentWorkspace?.description ?? '');
  const [icon, setIcon] = useState(() => currentWorkspace?.icon ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // Invite dialog state
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [inviteRole, setInviteRole] = useState<AssignableWorkspaceRole>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Delete dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  if (!currentWorkspace || !workspaceId) {
    return (
      <div className="flex-1 bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const canEdit = canEditWorkspace(currentWorkspace);
  const canDelete = canDeleteWorkspace(currentWorkspace) && !isPersonal;

  const handleSave = async () => {
    const trimmed = name.trim();
    // Personal workspaces cannot be renamed — never send a name change for them.
    if (!isPersonal && !trimmed) {
      toast.error('Workspace name is required');
      return;
    }

    setIsSaving(true);
    try {
      await updateWorkspace(workspaceId, {
        // Omit `name` for personal workspaces (rename is blocked server-side).
        ...(isPersonal ? {} : { name: trimmed }),
        description: description.trim() || null,
      });
      toast.success('Workspace updated');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update workspace'));
    } finally {
      setIsSaving(false);
    }
  };

  // The avatar uploader resolves a public URL, then persists it immediately so
  // the change lands without requiring the (team-only) "Save changes" button.
  // Works for personal AND team workspaces — only renames are blocked for personal.
  const handleAvatarChange = async (url: string) => {
    setIcon(url);
    try {
      await updateWorkspace(workspaceId, { icon: url || null });
      toast.success(url ? 'Workspace avatar updated' : 'Workspace avatar removed');
    } catch (error) {
      // Revert the local preview to the persisted value on failure.
      setIcon(currentWorkspace.icon ?? '');
      toast.error(getErrorMessage(error, 'Failed to update workspace avatar'));
    }
  };

  const handleInviteDialogChange = (open: boolean) => {
    setShowInviteDialog(open);
    if (!open) {
      setInviteIdentifier('');
      setInviteRole('member');
      setInviteError(null);
    }
  };

  const handleInvite = async () => {
    const usernameOrEmail = inviteIdentifier.trim();
    if (!usernameOrEmail) {
      setInviteError('Enter a username or email to invite');
      return;
    }
    setInviteError(null);

    try {
      await inviteMemberMutation.mutateAsync({
        workspaceId,
        usernameOrEmail,
        role: inviteRole,
      });
      toast.success('Invitation sent');
      setShowInviteDialog(false);
      setInviteIdentifier('');
      setInviteRole('member');
    } catch (error) {
      if (isUserNotFoundError(error)) {
        setInviteError(USER_NOT_FOUND_MESSAGE);
        toast.error(USER_NOT_FOUND_MESSAGE);
        return;
      }
      toast.error(getErrorMessage(error, 'Failed to send invitation'));
    }
  };

  const handleRemoveMember = async (member: WorkspaceMember) => {
    try {
      await removeMemberMutation.mutateAsync({ workspaceId, memberId: member._id });
      toast.success('Member removed');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove member'));
    }
  };

  const handleRoleChange = async (member: WorkspaceMember, role: AssignableWorkspaceRole) => {
    if (role === member.role) {
      return;
    }
    try {
      await updateMemberMutation.mutateAsync({ workspaceId, memberId: member._id, role });
      toast.success('Role updated');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update role'));
    }
  };

  // Invitations are members with `status: 'invited'`; cancelling one is the
  // same operation as removing a member.
  const handleCancelInvite = async (invite: WorkspaceMember) => {
    try {
      await removeMemberMutation.mutateAsync({ workspaceId, memberId: invite._id });
      toast.success('Invitation cancelled');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to cancel invitation'));
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmation !== currentWorkspace.name) {
      toast.error('Please type the workspace name to confirm');
      return;
    }

    setIsDeleting(true);
    try {
      await deleteWorkspace(workspaceId);
      toast.success('Workspace deleted');
      setShowDeleteDialog(false);
      setDeleteConfirmation('');
    } catch (error) {
      // The API returns 409 when the workspace still owns applications.
      toast.error(
        getErrorMessage(
          error,
          'Failed to delete workspace. Move or delete its apps first.'
        )
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ScrollArea className="flex-1 bg-background">
      {/* Header */}
      <div className="px-6 py-6 border-b border-border">
        <Link
          to="/dashboard"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          Back to dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex aspect-square size-10 items-center justify-center overflow-hidden rounded-lg bg-primary text-primary-foreground">
            {currentWorkspace.icon ? (
              <img
                src={currentWorkspace.icon}
                alt={currentWorkspace.name}
                className="size-full object-cover"
              />
            ) : (
              <HugeiconsIcon icon={UserMultiple02Icon} size={20} />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Workspace Settings</h1>
            <p className="text-sm text-muted-foreground">{currentWorkspace.name}</p>
          </div>
        </div>
      </div>

      {/* General Settings */}
      <div className="px-6 py-6 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground mb-4">General</h2>
        <div className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label>Avatar</Label>
            <ImageUploadField
              oxyServices={oxyServices}
              value={icon}
              onChange={handleAvatarChange}
              disabled={!canEdit}
              label="Workspace avatar"
              onError={(message) => toast.error(message)}
              fallback={
                <HugeiconsIcon icon={UserMultiple02Icon} size={24} className="text-muted-foreground" />
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Workspace name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit || isPersonal}
              maxLength={50}
            />
            {isPersonal && (
              <p className="text-xs text-muted-foreground">
                Personal workspace name cannot be changed
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit}
              placeholder="A brief description of your workspace"
              rows={3}
            />
          </div>
          {canEdit && !isPersonal && (
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save changes'}
            </Button>
          )}
        </div>
      </div>

      {/* Team Members */}
      {!isPersonal && (
        <div className="px-6 py-6 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Team Members</h2>
            {canManage && (
              <Button size="sm" onClick={() => setShowInviteDialog(true)}>
                <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1.5" />
                Invite
              </Button>
            )}
          </div>

          {/* Members List */}
          {membersQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : activeMembers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <div className="space-y-2">
              {activeMembers.map((member) => {
                const isOwner = member.role === 'owner';
                const isLastOwner = isOwner && ownerCount <= 1;
                const canEditThisRole = canManage && !isOwner;
                const canRemoveThisMember = canManage && !isOwner && !isLastOwner;

                return (
                  <div
                    key={member._id}
                    className="flex items-center justify-between py-3 px-4 rounded-lg border"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="size-8">
                        <AvatarFallback>
                          {member.userId[0]?.toUpperCase() ?? '?'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-mono truncate" title={member.userId}>
                          {shortUserId(member.userId)}
                        </p>
                        <p className="text-xs text-muted-foreground">{roleLabels[member.role]}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwner ? (
                        <Badge variant="secondary" className="gap-1">
                          <HugeiconsIcon icon={CrownIcon} size={12} />
                          Owner
                        </Badge>
                      ) : canEditThisRole ? (
                        <Select
                          value={member.role}
                          onValueChange={(value) =>
                            handleRoleChange(member, value as AssignableWorkspaceRole)
                          }
                        >
                          <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((role) => (
                              <SelectItem key={role} value={role}>
                                {roleLabels[role]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">{roleLabels[member.role]}</Badge>
                      )}
                      {canRemoveThisMember && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleRemoveMember(member)}
                          aria-label="Remove member"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pending Invites */}
          {pendingInvites.length > 0 && (
            <>
              <Separator className="my-4" />
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Pending Invites</h3>
              <div className="space-y-2">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite._id}
                    className="flex items-center justify-between py-3 px-4 rounded-lg border border-dashed"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center justify-center size-8 rounded-full bg-muted shrink-0">
                        <HugeiconsIcon
                          icon={Mail01Icon}
                          size={14}
                          className="text-muted-foreground"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-mono truncate" title={invite.userId}>
                          {shortUserId(invite.userId)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Invited as {roleLabels[invite.role]}
                          {invite.createdAt
                            ? ` • ${new Date(invite.createdAt).toLocaleDateString()}`
                            : ''}
                        </p>
                      </div>
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancelInvite(invite)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Billing — workspace billing isn't a backend concept here; the dedicated
          Billing page covers it. */}
      <div className="px-6 py-6 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground mb-4">Billing</h2>
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div>
            <p className="text-sm font-medium">Billing &amp; usage</p>
            <p className="text-xs text-muted-foreground">
              Manage your plan, credits, and invoices.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/billing">Manage billing</Link>
          </Button>
        </div>
      </div>

      {/* Danger Zone */}
      {canDelete && (
        <div className="px-6 py-6">
          <h2 className="text-sm font-semibold text-destructive mb-4">Danger Zone</h2>
          <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete workspace</p>
                <p className="text-xs text-muted-foreground">
                  This permanently deletes the workspace. Move or delete its apps first.
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
                <HugeiconsIcon icon={Delete02Icon} size={14} className="mr-1.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={handleInviteDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite team member</DialogTitle>
            <DialogDescription>
              Add a member by their username or email and choose their role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-identifier">Username or email</Label>
              <Input
                id="invite-identifier"
                value={inviteIdentifier}
                onChange={(e) => {
                  setInviteIdentifier(e.target.value);
                  if (inviteError) {
                    setInviteError(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleInvite();
                  }
                }}
                placeholder="alice or alice@example.com"
                aria-invalid={inviteError ? true : undefined}
                aria-describedby={inviteError ? 'invite-identifier-error' : undefined}
              />
              {inviteError && (
                <p id="invite-identifier-error" className="text-sm text-destructive">
                  {inviteError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as AssignableWorkspaceRole)}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      <div className="flex flex-col">
                        <span className="font-medium">{roleLabels[role]}</span>
                        <span className="text-xs text-muted-foreground">
                          {roleDescriptions[role]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleInviteDialogChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleInvite}
              disabled={inviteMemberMutation.isPending || !inviteIdentifier.trim()}
            >
              {inviteMemberMutation.isPending ? 'Sending...' : 'Send invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the workspace "
              {currentWorkspace.name}". The workspace must have no apps before it can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="delete-confirm" className="text-sm">
              Type <span className="font-mono font-semibold">{currentWorkspace.name}</span> to
              confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              className="mt-2"
              placeholder={currentWorkspace.name}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmation('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteConfirmation !== currentWorkspace.name || isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  );
}
