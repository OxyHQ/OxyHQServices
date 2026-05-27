/**
 * Per-user App-Data Mixin
 *
 * Thin client around `/users/me/app-data/...` — a generic per-user JSON KV
 * store on the API. Authenticated callers can read, write, list, and delete
 * entries scoped to their own user account.
 *
 * Identifier rules (must match the API):
 *   - Both `namespace` and `key` must match `/^[a-z0-9_-]{1,64}$/u`.
 *
 * Limits (enforced by the API):
 *   - Serialized JSON values are capped at 64 KB.
 *   - Writes are rate-limited to 100 / minute / user.
 *
 * Intended use cases are small bits of cross-device app state — e.g. Academy
 * course progress, "last viewed" markers, dismissed banner flags. Do not use
 * this for large blobs or anything that needs server-side querying; it's a
 * write-it-and-read-it-back store.
 */

import type { OxyServicesBase } from '../OxyServices.base';

/**
 * Identifier validator — mirror of the API regex. Validating client-side
 * gives consumers a clean throw before the request even leaves the device.
 */
const APP_DATA_IDENTIFIER_PATTERN = /^[a-z0-9_-]{1,64}$/u;

/** Thrown when a namespace or key fails the kebab/snake-case validator. */
export class OxyAppDataIdentifierError extends Error {
  constructor(field: 'namespace' | 'key', value: string) {
    super(
      `Invalid app-data ${field} "${value}": must match [a-z0-9_-]{1,64} (lowercase letters, digits, dashes, underscores).`,
    );
    this.name = 'OxyAppDataIdentifierError';
  }
}

function assertIdentifier(field: 'namespace' | 'key', value: string): void {
  if (!APP_DATA_IDENTIFIER_PATTERN.test(value)) {
    throw new OxyAppDataIdentifierError(field, value);
  }
}

/** Wire shape of `GET /users/me/app-data/:namespace/:key`. */
interface AppDataValueResponse<T> {
  value: T | null;
}

/** Wire shape of `GET /users/me/app-data/:namespace`. */
interface AppDataNamespaceResponse<T> {
  entries: Record<string, T>;
}

export function OxyServicesAppDataMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Read the value stored under `(namespace, key)` for the current user.
     *
     * @returns The previously-stored value, or `null` if nothing has been
     *   stored yet. Never throws on "not found" — a missing entry is
     *   semantically a `null` value.
     */
    async getAppData<TValue = unknown>(
      namespace: string,
      key: string,
    ): Promise<TValue | null> {
      assertIdentifier('namespace', namespace);
      assertIdentifier('key', key);

      return this.withAuthRetry(async () => {
        const response = await this.makeRequest<AppDataValueResponse<TValue>>(
          'GET',
          `/users/me/app-data/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
          undefined,
          { cache: false },
        );
        return response?.value ?? null;
      }, 'getAppData');
    }

    /**
     * Upsert the value under `(namespace, key)` for the current user.
     *
     * Returns the value the server confirmed it stored — typically the same
     * value the caller passed in, but consumers should prefer the returned
     * value (the API is the source of truth).
     *
     * @throws OxyAppDataIdentifierError when namespace or key is malformed.
     */
    async setAppData<TValue = unknown>(
      namespace: string,
      key: string,
      value: TValue,
    ): Promise<TValue> {
      assertIdentifier('namespace', namespace);
      assertIdentifier('key', key);

      return this.withAuthRetry(async () => {
        const response = await this.makeRequest<AppDataValueResponse<TValue>>(
          'PUT',
          `/users/me/app-data/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
          { value },
          { cache: false },
        );
        // The server echoes the stored value back; fall back to the caller's
        // input only if the server somehow omitted it (defensive — the route
        // always sets it).
        return (response?.value ?? value) as TValue;
      }, 'setAppData');
    }

    /**
     * Delete the value stored under `(namespace, key)` for the current user.
     *
     * Idempotent — resolves successfully whether or not the entry existed.
     */
    async deleteAppData(namespace: string, key: string): Promise<void> {
      assertIdentifier('namespace', namespace);
      assertIdentifier('key', key);

      await this.withAuthRetry(async () => {
        await this.makeRequest<void>(
          'DELETE',
          `/users/me/app-data/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
          undefined,
          { cache: false },
        );
      }, 'deleteAppData');
    }

    /**
     * List every entry stored under `namespace` for the current user.
     *
     * Returns an empty object when the namespace contains no entries (the
     * endpoint never 404s on an empty namespace).
     */
    async listAppData<TValue = unknown>(
      namespace: string,
    ): Promise<Record<string, TValue>> {
      assertIdentifier('namespace', namespace);

      return this.withAuthRetry(async () => {
        const response = await this.makeRequest<AppDataNamespaceResponse<TValue>>(
          'GET',
          `/users/me/app-data/${encodeURIComponent(namespace)}`,
          undefined,
          { cache: false },
        );
        return response?.entries ?? {};
      }, 'listAppData');
    }
  };
}
