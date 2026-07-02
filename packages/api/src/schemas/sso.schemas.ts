import { z } from 'zod';

/**
 * `POST /sso/establish-token` request body.
 *
 * `origin` is the RP web origin the caller wants to establish a durable IdP
 * session for (validated server-side against the approved-clients allow-list AND
 * the request `Origin` header). `state` is the opaque CSRF value the RP persists
 * under `ssoStateKey(origin)`; it is echoed verbatim into the `/sso/establish`
 * callback fragment so the post-bounce `sso-return` step can validate it. Both
 * are length-capped to bound abuse — a normal `state` is a UUID (~36 chars).
 */
export const ssoEstablishTokenSchema = z.object({
  origin: z.string().min(1).max(2048),
  state: z.string().min(1).max(512),
});

export type SsoEstablishTokenRequest = z.infer<typeof ssoEstablishTokenSchema>;
