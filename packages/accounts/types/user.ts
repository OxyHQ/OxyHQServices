import type { User } from '@oxyhq/services';

/**
 * Extended User type for accounts app
 * Adds optional properties that may exist on user objects but aren't in the base type
 */
export interface ExtendedUser extends User {
  /**
   * User's phone number
   */
  phone?: string | null;
  
  /**
   * User's address (alternative to location)
   */
  address?: string | null;
  
  /**
   * User's birthday
   */
  birthday?: string | null;
  
  /**
   * User's date of birth (alternative to birthday)
   */
  dateOfBirth?: string | null;
}

