/**
 * Zod schemas for the device-first auth surface (`/auth/device/*` +
 * `/auth/refresh-token`).
 *
 * The wire CONTRACTS (request + response) live in `@oxyhq/contracts`
 * (`deviceBoot.ts`) — the single source of truth shared with the SDK. This file
 * imports the request schemas for route-body validation and adds the one
 * server-only input the contract does not model: the bootstrap query string
 * (`return_to` + CSRF `state`), which the handler additionally validates for
 * https/loopback + trusted-origin + size.
 */

import { z } from 'zod';

export {
  deviceExchangeRequestSchema,
  tokenRefreshRequestSchema,
  deviceResolveRequestSchema,
} from '@oxyhq/contracts';

/**
 * `GET /auth/device/bootstrap?return_to=<url>&state=<opaque≤256>`.
 *
 * `return_to` is size-capped here (2KB) and further validated in the handler
 * (parseable https URL, no embedded credentials, origin on the trusted lane, or
 * an http loopback dev origin). `state` is an opaque CSRF echo the client stored
 * in its tab's sessionStorage and re-verifies on return; it is bounded to 256
 * chars to match `deviceBootFragmentSchema`.
 */
export const deviceBootstrapQuerySchema = z.object({
  return_to: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
});

export type DeviceBootstrapQuery = z.infer<typeof deviceBootstrapQuerySchema>;
