import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  UserAdd01Icon,
  Delete02Icon,
  CrownIcon,
  ArrowDataTransferHorizontalIcon,
} from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { toast } from 'sonner';
import { getErrorMessage, isUserNotFoundError, USER_NOT_FOUND_MESSAGE } from '@/lib/api-error';
import {
  useApplicationMembers,
  useInviteMember,
  useUpdateMember,
  useRemoveMember,
  useTransferOwnership,
  type Application,
  type ApplicationMember,
  type ApplicationRole,
  type InviteMemberInput,
  type CallerAccess,
} from '@/hooks/use-applications';

/** Roles assignable via invite — everything except `owner`. */
type AssignableRole = InviteMemberInput['role'];

// Roles that can be assigned to a non-owner member. Ownership is changed only
// via the transfer-ownership flow.
const ASSIGNABLE_ROLES: { value: AssignableRole; label: string; description: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Manage members, credentials, and settings' },
  { value: 'developer', label: 'Developer', description: 'Manage credentials and webhooks' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
  { value: 'billing', label: 'Billing', description: 'Manage billing' },
];

function roleLabel(role: ApplicationRole): string {
  if (role === 'owner') {
    return 'Owner';
  }
  return ASSIGNABLE_ROLES.find((r) => r.value === role)?.label ?? role;
}

interface MembersSectionProps {
  application: Application;
  access: CallerAccess;
}

export function MembersSection({ application, access }: MembersSectionProps) {
  const appId = application._id;
  const canRead = access.can('members:read');
  const canInvite = access.can('members:invite');
  const canUpdate = access.can('members:update');
  const canRemove = access.can('members:remove');
  const canTransfer = access.can('ownership:transfer');

  const { data: members = [], isLoading } = useApplicationMembers(appId, canRead);
  const inviteMember = useInviteMember();
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();
  const transferOwnership = useTransferOwnership();

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [inviteRole, setInviteRole] = useState<AssignableRole>('developer');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<ApplicationMember | null>(null);
  const [memberToPromote, setMemberToPromote] = useState<ApplicationMember | null>(null);

  const ownerCount = members.filter((m) => m.role === 'owner').length;

  const handleInviteDialogChange = (open: boolean) => {
    setShowInviteDialog(open);
    if (!open) {
      setInviteIdentifier('');
      setInviteRole('developer');
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
      await inviteMember.mutateAsync({
        appId,
        data: { usernameOrEmail, role: inviteRole },
      });
      setShowInviteDialog(false);
      setInviteIdentifier('');
      setInviteRole('developer');
      toast.success('Member added');
    } catch (error) {
      if (isUserNotFoundError(error)) {
        setInviteError(USER_NOT_FOUND_MESSAGE);
        toast.error(USER_NOT_FOUND_MESSAGE);
        return;
      }
      toast.error(getErrorMessage(error, 'Failed to add member'));
    }
  };

  const handleChangeRole = async (member: ApplicationMember, role: ApplicationRole) => {
    if (role === member.role) {
      return;
    }
    // Synthetic, workspace-derived memberships have no `_id` and are managed
    // via Workspace settings, not per-app.
    if (!member._id) {
      return;
    }
    try {
      await updateMember.mutateAsync({ appId, memberId: member._id, data: { role } });
      toast.success('Role updated');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update role'));
    }
  };

  const handleRemove = async () => {
    if (!memberToRemove || !memberToRemove._id) {
      return;
    }
    try {
      await removeMember.mutateAsync({ appId, memberId: memberToRemove._id });
      setMemberToRemove(null);
      toast.success('Member removed');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove member'));
    }
  };

  const handleTransfer = async () => {
    if (!memberToPromote) {
      return;
    }
    try {
      await transferOwnership.mutateAsync({ appId, userId: memberToPromote.userId });
      setMemberToPromote(null);
      toast.success('Ownership transferred');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to transfer ownership'));
    }
  };

  if (!canRead) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        You do not have permission to view members.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Members</h2>
          <p className="text-sm text-muted-foreground">People with access to this application.</p>
        </div>
        {canInvite && (
          <Button size="sm" onClick={() => setShowInviteDialog(true)}>
            <HugeiconsIcon icon={UserAdd01Icon} size={16} className="mr-2" />
            Add member
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {members.map((member) => {
            const isOwner = member.role === 'owner';
            const isSelf = member.userId === access.membership?.userId;
            const isLastOwner = isOwner && ownerCount <= 1;
            // Synthetic, workspace-derived rows (`_id: null` / `source: 'workspace'`)
            // are managed in Workspace settings, never per-app — render them
            // read-only here.
            const isWorkspaceManaged = member._id === null || member.source === 'workspace';
            // An owner's role cannot be changed inline; admins cannot modify owners.
            const canEditThisRole = canUpdate && !isOwner && !isWorkspaceManaged;
            const canRemoveThisMember =
              canRemove && !isLastOwner && !isWorkspaceManaged && (!isOwner || canTransfer);
            const canTransferToThis =
              canTransfer && !isOwner && !isWorkspaceManaged && member.status === 'active';

            return (
              <div
                key={member._id ?? `workspace:${member.userId}`}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono text-foreground truncate">{member.userId}</p>
                    {isOwner && (
                      <Badge variant="default" className="gap-1">
                        <HugeiconsIcon icon={CrownIcon} size={12} />
                        Owner
                      </Badge>
                    )}
                    {member.status !== 'active' && (
                      <Badge variant="secondary" className="text-xs capitalize">
                        {member.status}
                      </Badge>
                    )}
                    {isSelf && (
                      <Badge variant="outline" className="text-xs">
                        You
                      </Badge>
                    )}
                    {isWorkspaceManaged && (
                      <Badge variant="secondary" className="text-xs">
                        Workspace
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {canEditThisRole ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) =>
                        handleChangeRole(member, value as ApplicationRole)
                      }
                    >
                      <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((role) => (
                          <SelectItem key={role.value} value={role.value}>
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">{roleLabel(member.role)}</Badge>
                  )}

                  {canTransferToThis && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setMemberToPromote(member)}
                      aria-label="Transfer ownership"
                      title="Transfer ownership"
                    >
                      <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} size={16} />
                    </Button>
                  )}

                  {canRemoveThisMember && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setMemberToRemove(member)}
                      aria-label="Remove member"
                      title="Remove member"
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={16} className="text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invite Member Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={handleInviteDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              Add a member by their username or email and choose their role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-identifier" className="text-sm">
                Username or email
              </Label>
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
              <Label htmlFor="invite-role" className="text-sm">
                Role
              </Label>
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as AssignableRole)}
              >
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      <div className="flex flex-col">
                        <span>{role.label}</span>
                        <span className="text-xs text-muted-foreground">{role.description}</span>
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
              disabled={inviteMember.isPending || !inviteIdentifier.trim()}
            >
              {inviteMember.isPending ? 'Adding...' : 'Add member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation */}
      <AlertDialog
        open={!!memberToRemove}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member</AlertDialogTitle>
            <AlertDialogDescription>
              Remove this member from the application? They will lose all access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={removeMember.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMember.isPending ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transfer Ownership Confirmation */}
      <AlertDialog
        open={!!memberToPromote}
        onOpenChange={(open) => !open && setMemberToPromote(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership</AlertDialogTitle>
            <AlertDialogDescription>
              Transfer ownership of this application to this member? You will be demoted to admin.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleTransfer} disabled={transferOwnership.isPending}>
              {transferOwnership.isPending ? 'Transferring...' : 'Transfer ownership'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
