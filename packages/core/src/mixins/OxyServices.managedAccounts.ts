/**
 * Managed Accounts Methods Mixin
 *
 * Provides SDK methods for creating and managing sub-accounts (managed identities).
 * Managed accounts are full User documents without passwords, accessible only
 * by their owners/managers via the X-Acting-As header mechanism.
 */
import type { User } from '../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';

export interface CreateManagedAccountInput {
  username: string;
  name?: { first?: string; last?: string };
  bio?: string;
  avatar?: string;
}

export interface ManagedAccountManager {
  userId: string;
  role: 'owner' | 'admin' | 'editor';
  addedAt: string;
  addedBy?: string;
}

export interface ManagedAccount {
  accountId: string;
  ownerId: string;
  managers: ManagedAccountManager[];
  account?: User;
  createdAt?: string;
  updatedAt?: string;
}

export function OxyServicesManagedAccountsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Create a new managed account (sub-account).
     *
     * The server creates a User document with `isManagedAccount: true` and links
     * it to the authenticated user as owner.
     */
    async createManagedAccount(data: CreateManagedAccountInput): Promise<ManagedAccount> {
      try {
        return await this.makeRequest<ManagedAccount>('POST', '/managed-accounts', data, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * List all accounts the authenticated user manages.
     */
    async getManagedAccounts(): Promise<ManagedAccount[]> {
      try {
        return await this.makeRequest<ManagedAccount[]>('GET', '/managed-accounts', undefined, {
          cache: true,
          cacheTTL: 2 * 60 * 1000, // 2 minutes cache
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get details for a specific managed account.
     */
    async getManagedAccountDetails(accountId: string): Promise<ManagedAccount> {
      try {
        return await this.makeRequest<ManagedAccount>('GET', `/managed-accounts/${accountId}`, undefined, {
          cache: true,
          cacheTTL: 2 * 60 * 1000,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update a managed account's profile data.
     * Requires owner or admin role.
     */
    async updateManagedAccount(accountId: string, data: Partial<CreateManagedAccountInput>): Promise<ManagedAccount> {
      try {
        return await this.makeRequest<ManagedAccount>('PUT', `/managed-accounts/${accountId}`, data, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Delete a managed account permanently.
     * Requires owner role.
     */
    async deleteManagedAccount(accountId: string): Promise<void> {
      try {
        await this.makeRequest<void>('DELETE', `/managed-accounts/${accountId}`, undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Add a manager to a managed account.
     * Requires owner or admin role on the account.
     *
     * @param accountId - The managed account to add the manager to
     * @param userId - The user to grant management access
     * @param role - The role to assign: 'admin' or 'editor'
     */
    async addManager(accountId: string, userId: string, role: 'admin' | 'editor'): Promise<void> {
      try {
        await this.makeRequest<void>('POST', `/managed-accounts/${accountId}/managers`, { userId, role }, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Remove a manager from a managed account.
     * Requires owner role.
     *
     * @param accountId - The managed account
     * @param userId - The manager to remove
     */
    async removeManager(accountId: string, userId: string): Promise<void> {
      try {
        await this.makeRequest<void>('DELETE', `/managed-accounts/${accountId}/managers/${userId}`, undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
