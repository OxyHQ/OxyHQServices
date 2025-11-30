/**
 * User display name and date formatting utilities
 */

/**
 * Formats a date string to a readable format (e.g., "Feb 21, 2025")
 */
export const formatDate = (dateString: string | undefined | null | Date): string => {
  if (!dateString) return '';
  
  try {
    const date = dateString instanceof Date ? dateString : new Date(dateString);
    if (isNaN(date.getTime())) return '';
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
};

/**
 * Gets a display name from user data
 */
export const getDisplayName = (user: { name?: { full?: string; first?: string; last?: string }; username?: string } | null | undefined): string => {
  if (!user) return 'User';
  
  const fullName = user.name?.full;
  if (fullName) return fullName;
  
  const firstLast = [user.name?.first, user.name?.last].filter(Boolean).join(' ').trim();
  if (firstLast) return firstLast;
  
  return user.username || 'User';
};

/**
 * Gets a short display name (first name or username)
 */
export const getShortDisplayName = (user: { name?: { first?: string; full?: string }; username?: string } | null | undefined): string => {
  if (!user) return 'User';
  
  const firstName = user.name?.first || user.name?.full?.split(' ')[0];
  if (firstName) return firstName;
  
  return user.username || 'User';
};

