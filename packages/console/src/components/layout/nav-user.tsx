import { HugeiconsIcon } from '@hugeicons/react';
import {
  Logout03Icon,
  Setting06Icon,
  Money01Icon,
  ArrowUp01Icon,
  Notification01Icon,
  UserCircleIcon,
} from '@hugeicons/core-free-icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@oxyhq/services';
import { Link } from '@tanstack/react-router';
import config from '@/lib/config';

export function NavUser() {
  const { isMobile } = useSidebar();
  const { user, signOut, oxyServices } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    window.location.href = '/';
  };

  const getUserInitials = () => {
    if (!user?.name) return user?.username?.[0]?.toUpperCase() || 'U';
    const name = user.name as { first?: string; last?: string };
    if (name.first && name.last) {
      return `${name.first[0]}${name.last[0]}`.toUpperCase();
    }
    return (name.first?.[0] || user?.username?.[0] || 'U').toUpperCase();
  };

  const getAvatarUrl = () => {
    if (!user?.avatar) return undefined;
    if (user.avatar.startsWith('http')) return user.avatar;
    return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
  };

  // The API resolves the canonical display string as `name.displayName`; render
  // it directly rather than recomposing from `name.first` / `name.last` /
  // `username`.
  const displayName = user?.name.displayName ?? 'User';

  if (!user) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={getAvatarUrl()} alt={displayName} />
                <AvatarFallback className="rounded-lg">{getUserInitials()}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <HugeiconsIcon icon={ArrowUp01Icon} className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={getAvatarUrl()} alt={displayName} />
                  <AvatarFallback className="rounded-lg">{getUserInitials()}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayName}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <a href={config.accountsUrl} target="_blank" rel="noopener noreferrer">
                  <HugeiconsIcon icon={UserCircleIcon} size={16} />
                  Manage account
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/billing">
                  <HugeiconsIcon icon={Money01Icon} size={16} />
                  Billing
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <HugeiconsIcon icon={Notification01Icon} size={16} />
                Notifications
              </DropdownMenuItem>
              <DropdownMenuItem>
                <HugeiconsIcon icon={Setting06Icon} size={16} />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <HugeiconsIcon icon={Logout03Icon} size={16} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
