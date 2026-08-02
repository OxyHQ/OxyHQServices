/**
 * Date formatting utilities for the accounts app.
 */

/**
 * Formats a date string to a readable format (e.g., "Feb 21, 2025")
 */
export const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '';

  try {
    const date = new Date(dateString);
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
