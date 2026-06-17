import type { OxyServicesBase } from "../OxyServices.base";
import type { SessionLoginResponse } from "../models/session";
import { createDebugLogger } from "../shared/utils/debugUtils";

const debug = createDebugLogger("SilentAuth");

export interface SilentAuthOptions {
	timeout?: number;
	/**
	 * Override the auth-web (IdP) origin used for the silent iframe, instead of
	 * the instance's configured `resolveAuthUrl()`.
	 *
	 * Why this exists: an instance configured with the CENTRAL IdP
	 * (`authWebUrl=https://auth.oxy.so`, for the opaque-code `/sso` bounce and
	 * FedCM) cannot read the DURABLE per-apex `fedcm_session` cookie via the
	 * central host — that cookie is first-party only on `auth.<rp-apex>` (e.g.
	 * `auth.mention.earth`). The cross-domain reload-restore path must point the
	 * `/auth/silent` iframe at the PER-APEX host so the cookie is same-site to
	 * the RP page (first-party under Safari ITP / Firefox TCP) and the restore
	 * is NOT a top-level navigation (no flash, works in a backgrounded tab).
	 *
	 * When provided this value is used BOTH for the iframe `src` AND for the
	 * `postMessage` origin validation in {@link waitForIframeAuth}, so the
	 * security check still matches the exact origin the iframe was loaded from.
	 * Must be an absolute origin (`https://auth.<apex>`); ignored if empty.
	 */
	authWebUrlOverride?: string;
}

/**
 * Cross-domain silent browser auth helpers.
 *
 * The clean session model supports FedCM, tokenless redirect SSO, and silent
 * iframe SSO. Bearer-token callback URLs are not part of this surface.
 */
export function OxyServicesSilentAuthMixin<T extends typeof OxyServicesBase>(
	Base: T,
) {
	return class extends Base {
		constructor(...args: any[]) {
			super(...(args as [any]));
		}
		public static readonly DEFAULT_AUTH_URL = "https://auth.oxy.so";

		/** Resolve auth URL from config or static default (method, not getter — getters break in TS mixins) */
		public resolveAuthUrl(): string {
			return (
				this.config.authWebUrl || (this.constructor as any).DEFAULT_AUTH_URL
			);
		}

		public static readonly SILENT_TIMEOUT = 5000; // 5 seconds

		/**
		 * Silent sign-in using hidden iframe
		 *
		 * Attempts to automatically re-authenticate the user without any UI.
		 * This is what enables seamless SSO across all Oxy domains.
		 *
		 * How it works:
		 * 1. Creates hidden iframe pointing to auth.oxy.so/silent-auth
		 * 2. If user has valid session at auth.oxy.so, it exchanges an opaque SSO code
		 * 3. If not, iframe responds with null (no error thrown)
		 *
		 * This should be called on app startup to check for existing sessions.
		 *
		 * @param options - Silent auth options
		 * @returns Session if user is signed in, null otherwise
		 *
		 * @example
		 * ```typescript
		 * useEffect(() => {
		 *   const checkAuth = async () => {
		 *     const session = await oxyServices.silentSignIn();
		 *     if (session) {
		 *       setUser(session.user);
		 *     }
		 *   };
		 *   checkAuth();
		 * }, []);
		 * ```
		 */
		async silentSignIn(
			options: SilentAuthOptions = {},
		): Promise<SessionLoginResponse | null> {
			if (typeof window === "undefined") {
				return null;
			}

			const timeout =
				options.timeout || (this.constructor as any).SILENT_TIMEOUT;
			const nonce = this.generateNonce();
			const clientId = window.location.origin;

			// Resolve the IdP origin for the iframe. An explicit per-apex override (the
			// durable cross-domain reload path — see `SilentAuthOptions.authWebUrlOverride`)
			// wins over the instance's configured central auth URL. The SAME origin is
			// handed to `waitForIframeAuth` so the postMessage origin check matches the
			// exact host the iframe was loaded from.
			const authOrigin =
				options.authWebUrlOverride && options.authWebUrlOverride.length > 0
					? options.authWebUrlOverride
					: this.resolveAuthUrl();

			const iframe = document.createElement("iframe");
			iframe.style.display = "none";
			iframe.style.position = "absolute";
			iframe.style.width = "0";
			iframe.style.height = "0";
			iframe.style.border = "none";

			const silentUrl =
				`${authOrigin}/auth/silent?` +
				`client_id=${encodeURIComponent(clientId)}&` +
				`nonce=${nonce}`;

			iframe.src = silentUrl;
			document.body.appendChild(iframe);

			try {
				const session = await this.waitForIframeAuth(
					iframe,
					timeout,
					authOrigin,
				);

				// Bail early on incomplete responses. The iframe contract requires
				// both an access token and a session id; anything less is unusable.
				// Returning `null` here (without installing the token) prevents a
				// stale credential from being committed to HttpService when the
				// user is actually signed out — that pattern caused a `getCurrentUser`
				// -> 401 -> token-clear loop in consumer apps because callers gated
				// on `session?.user` and never installed the user via
				// `handleAuthSuccess`, while HttpService quietly held the token.
				const accessToken = session
					? (session as { accessToken?: string }).accessToken
					: undefined;
				if (!session || !accessToken || !session.sessionId) {
					return null;
				}

				// Snapshot the previous token so we can roll back if the user
				// lookup below fails — this avoids leaving a half-committed session
				// (token installed, user missing) which would let the next
				// authenticated request 401 with no way to recover.
				const previousAccessToken = this.httpService.getAccessToken();
				this.httpService.setTokens(accessToken);

				// The iframe typically returns `{ sessionId, accessToken }` without
				// user data. Fetch the user explicitly so callers receive a
				// fully-formed session and never need a second `/users/me` round
				// trip. If this fails the session is unusable — revert the token
				// and return null so the caller treats this exactly like a
				// missing-session response.
				if (!session.user) {
					try {
						const userData = await this.makeRequest<unknown>(
							"GET",
							`/session/user/${session.sessionId}`,
							undefined,
							{ cache: false, retry: false },
						);
						if (!userData) {
							throw new Error("Empty user response");
						}
						(session as { user?: unknown }).user = userData;
					} catch (userError) {
						debug.warn(
							"silentSignIn: failed to fetch user data, rolling back token",
							userError,
						);
						if (previousAccessToken) {
							this.httpService.setTokens(previousAccessToken);
						} else {
							this.httpService.clearTokens();
						}
						return null;
					}
				}

				return session;
			} catch (error) {
				return null;
			} finally {
				document.body.removeChild(iframe);
			}
		}

		/**
		 * Wait for authentication response from iframe
		 *
		 * @private
		 */
		public async waitForIframeAuth(
			iframe: HTMLIFrameElement,
			timeout: number,
			expectedOrigin: string,
		): Promise<SessionLoginResponse | null> {
			return new Promise((resolve) => {
				const timeoutId = setTimeout(() => {
					cleanup();
					resolve(null); // Silent failure - don't throw
				}, timeout);

				const messageHandler = (event: MessageEvent) => {
					// Verify origin against the EXACT host the iframe was loaded from
					// (`expectedOrigin`). For the per-apex durable-restore path this is
					// `auth.<rp-apex>`, not the instance's central `resolveAuthUrl()` — so
					// we must honour the caller-supplied origin, never re-derive it here.
					if (event.origin !== expectedOrigin) {
						return;
					}

					const { type, session } = event.data;

					if (type !== "oxy_silent_auth") {
						return;
					}

					cleanup();
					resolve(session || null);
				};

				// Fail-fast on a load failure. When the per-apex `/auth/silent` host is
				// unreachable, blocked by CSP `frame-ancestors`/`X-Frame-Options`, or the
				// network drops, the iframe never posts a message — without this handler
				// the silent restore would block for the FULL `timeout` (dead latency in
				// the cold-boot critical path). `onerror`/`onabort` fire on a failed load,
				// so resolve `null` immediately and let the next cold-boot step run. The
				// success path posts a message and is handled above; these only catch the
				// no-message failure modes.
				const failFast = () => {
					cleanup();
					resolve(null);
				};
				iframe.onerror = failFast;
				iframe.onabort = failFast;

				const cleanup = () => {
					clearTimeout(timeoutId);
					iframe.onerror = null;
					iframe.onabort = null;
					window.removeEventListener("message", messageHandler);
				};

				window.addEventListener("message", messageHandler);
			});
		}

		/**
		 * Generate nonce for replay attack prevention
		 *
		 * @private
		 */
		public generateNonce(): string {
			if (typeof crypto !== "undefined" && crypto.randomUUID) {
				return crypto.randomUUID();
			}
			if (typeof crypto !== "undefined" && crypto.getRandomValues) {
				const bytes = new Uint8Array(16);
				crypto.getRandomValues(bytes);
				return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
					"",
				);
			}
			throw new Error("No secure random source available for nonce generation");
		}
	};
}

// Export the mixin function as both named and default
export { OxyServicesSilentAuthMixin as SilentAuthMixin };
