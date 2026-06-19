/**
 * Unified HTTP Service
 * 
 * Consolidates HttpClient + RequestManager into a single efficient class.
 * Uses native fetch instead of axios for smaller bundle size.
 * 
 * Handles:
 * - Authentication (token management, auto-refresh)
 * - Caching (TTL-based)
 * - Deduplication (concurrent requests)
 * - Retry logic
 * - Error handling
 * - Request queuing
 */

import { TTLCache, registerCacheForCleanup } from './utils/cache';
import { RequestDeduplicator, RequestQueue, SimpleLogger } from './utils/requestUtils';
import { retryAsync } from './utils/asyncUtils';
import { handleHttpError } from './utils/errorUtils';
import { jwtDecode } from 'jwt-decode';
import { isNative, isReactNative, getPlatformOS } from './utils/platform';
import type { OxyConfig } from './models/interfaces';

/**
 * Check if we're running in a native app environment (React Native, not web)
 * This is used to determine CSRF handling mode
 */
const isNativeApp = isNative();

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export type AuthRefreshReason = 'preflight' | 'response-401';
export type AuthRefreshHandler = (reason: AuthRefreshReason) => Promise<string | null>;
export type AccessTokenProvider = () => string | null;

/**
 * Structural type that captures the multipart-write surface every supported
 * FormData implementation exposes (browser, React Native, Node `form-data`
 * polyfill, jsdom, undici, etc). We type-narrow against this in
 * `isFormData()` so callers don't have to know which runtime produced the
 * value.
 *
 * Deliberately mirrored from the lib.dom `FormData` interface — kept as a
 * local type because @types/node and @types/react-native model FormData
 * differently and a single import wouldn't be safe in both bundles.
 */
interface FormDataLike {
  append(name: string, value: unknown, fileName?: string): void;
  delete(name: string): void;
  get(name: string): unknown;
  getAll(name: string): unknown[];
  has(name: string): boolean;
}

/**
 * FNV-1a 32-bit non-cryptographic hash.
 *
 * Used by the cache-key generator for large payloads where full JSON
 * inclusion would balloon the cache map keys. Content-addressed: every
 * byte of the input contributes to the digest, so two payloads with the
 * same top-level shape but different field values produce different keys
 * (the previous `keys + length` heuristic collided on these).
 *
 * Trade-offs:
 *  - 32 bits is ample for an in-process cache (collision risk negligible
 *    at our key counts; we also prefix with method + url which further
 *    partitions the keyspace).
 *  - Not cryptographically secure — never use for security decisions.
 *  - Zero dependencies, branch-free hot loop, ~1 GiB/s on V8.
 */
function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h * 16777619 mod 2^32, written as shift-and-add for portability and
    // to avoid 53-bit JS number truncation in the intermediate multiply.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface RequestOptions {
  cache?: boolean;
  cacheTTL?: number;
  deduplicate?: boolean;
  retry?: boolean;
  maxRetries?: number;
  timeout?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

interface RequestConfig extends RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  data?: unknown;
  params?: Record<string, unknown>;
  /** @internal Used to prevent infinite auth retry loops */
  _isAuthRetry?: boolean;
  /** @internal Used to prevent infinite CSRF retry loops */
  _isCsrfRetry?: boolean;
}

/**
 * Token store for authentication (instance-based)
 * Each HttpService gets its own TokenStore to prevent conflicts
 * when multiple OxyServices instances coexist server-side.
 */
class TokenStore {
  private accessToken: string | null = null;
  private csrfToken: string | null = null;
  private csrfTokenFetchPromise: Promise<string | null> | null = null;

  setTokens(accessToken: string): void {
    this.accessToken = accessToken;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  clearTokens(): void {
    this.accessToken = null;
  }

  hasAccessToken(): boolean {
    return !!this.accessToken;
  }

  setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  getCsrfToken(): string | null {
    return this.csrfToken;
  }

  setCsrfTokenFetchPromise(promise: Promise<string | null> | null): void {
    this.csrfTokenFetchPromise = promise;
  }

  getCsrfTokenFetchPromise(): Promise<string | null> | null {
    return this.csrfTokenFetchPromise;
  }

  clearCsrfToken(): void {
    this.csrfToken = null;
    this.csrfTokenFetchPromise = null;
  }
}

/**
 * Unified HTTP Service
 * 
 * Consolidates HttpClient + RequestManager into a single efficient class.
 * Uses native fetch instead of axios for smaller bundle size.
 */
export class HttpService {
  private baseURL: string;
  private tokenStore: TokenStore;
  private cache: TTLCache<any>;
  private deduplicator: RequestDeduplicator;
  private requestQueue: RequestQueue;
  private logger: SimpleLogger;
  private config: OxyConfig;
  private tokenRefreshPromise: Promise<string | null> | null = null;
  private tokenRefreshCooldownUntil: number = 0;
  private authRefreshHandler: AuthRefreshHandler | null = null;
  private accessTokenProvider: AccessTokenProvider | null = null;

  /**
   * Fan-out listeners notified on EVERY access-token change on this instance:
   * explicit `setTokens`, `clearTokens`, an AuthManager-owned refresh, and the
   * internal 401-driven clear. This is a Set so multiple independent observers
   * can mirror token state without clobbering each other.
   *
   * Each listener receives the resulting access token, or `null` when cleared.
   */
  private _tokenChangeListeners = new Set<(accessToken: string | null) => void>();

  // Acting-as identity for managed accounts
  private _actingAsUserId: string | null = null;

  // Performance monitoring
  private requestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageResponseTime: 0,
  };

  constructor(config: OxyConfig) {
    this.config = config;
    this.baseURL = config.baseURL;
    this.tokenStore = new TokenStore();
    
    this.logger = new SimpleLogger(
      config.enableLogging || false,
      config.logLevel || 'error',
      'HttpService'
    );

    // Initialize performance infrastructure
    this.cache = new TTLCache<any>(config.cacheTTL || 5 * 60 * 1000);
    registerCacheForCleanup(this.cache);
    this.deduplicator = new RequestDeduplicator();
    this.requestQueue = new RequestQueue(
      config.maxConcurrentRequests || 10,
      config.requestQueueSize || 100
    );
  }

  private syncAccessTokenFromProvider(): string | null {
    if (!this.accessTokenProvider) {
      return this.tokenStore.getAccessToken();
    }

    const providedToken = this.accessTokenProvider();
    const currentToken = this.tokenStore.getAccessToken();

    if (providedToken) {
      if (providedToken !== currentToken) {
        this.tokenStore.setTokens(providedToken);
        this.notifyTokenChange();
      }
      return providedToken;
    }

    if (currentToken) {
      this.clearTokens();
    }

    return null;
  }

  /**
   * Robust FormData detection that works in browser, React Native, and
   * Node.js polyfill environments.
   *
   * Why we don't use `instanceof FormData` alone:
   *  - React Native's FormData is a separate class, not the browser one —
   *    `instanceof FormData` is true only inside the JS runtime that
   *    instantiated the value (browser-side polyfills also have their own).
   *  - The Node.js `form-data` polyfill ships its own constructor.
   *
   * Why we explicitly reject `URLSearchParams`:
   *  - `URLSearchParams` ALSO exposes `append` / `get` / `has`, so the
   *    duck-type fallback below would have misidentified it as FormData.
   *  - We want urlencoded payloads to take the JSON-stringify path so the
   *    server receives them as `application/x-www-form-urlencoded` instead
   *    of an empty multipart body.
   */
  private isFormData(data: unknown): data is FormDataLike {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Reject URLSearchParams up front: it shares the duck-typed surface
    // (append / get / has) but is a fundamentally different content type.
    // The caller routes URLSearchParams through the regular body path.
    if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
      return false;
    }

    // Primary check: instanceof FormData. Works whenever the value was
    // constructed by the same runtime/realm that exposes `FormData`.
    if (typeof FormData !== 'undefined' && data instanceof FormData) {
      return true;
    }

    // Fallback: detect Node / RN polyfills by constructor name. Limited to
    // the small handful of known names so we don't accept arbitrary
    // user-supplied objects with a coincidental `name`.
    const constructorName = data.constructor?.name;
    if (constructorName === 'FormData' || constructorName === 'FormDataImpl') {
      return true;
    }

    // Last-resort duck typing — require the full FormData write surface
    // (`append`, `get`, `has`, `getAll`, `delete`) so plain objects with
    // an `append` method don't accidentally match.
    const candidate = data as Partial<Record<keyof FormDataLike, unknown>>;
    return (
      typeof candidate.append === 'function' &&
      typeof candidate.get === 'function' &&
      typeof candidate.has === 'function' &&
      typeof candidate.getAll === 'function' &&
      typeof candidate.delete === 'function'
    );
  }

  /**
   * Main request method - handles everything in one place
   */
  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const {
      method,
      url,
      data,
      params,
      timeout = this.config.requestTimeout || 5000,
      signal,
      cache = method === 'GET',
      cacheTTL,
      deduplicate = true,
      retry = this.config.enableRetry !== false,
      maxRetries = this.config.maxRetries || 3,
    } = config;

    // Generate cache key (optimized for large objects)
    const cacheKey = cache ? this.generateCacheKey(method, url, data || params) : null;

    // Check cache first
    if (cache && cacheKey) {
      const cached = this.cache.get(cacheKey) as T | null;
      if (cached !== null) {
        this.requestMetrics.cacheHits++;
        this.logger.debug('Cache hit:', url);
        return cached;
      }
      this.requestMetrics.cacheMisses++;
    }

    // Request function
    const requestFn = async (): Promise<T> => {
      const startTime = Date.now();
      try {
        // Build URL with params
        const fullUrl = this.buildURL(url, params);
        
        // Get auth token (with auto-refresh)
        const authHeader = await this.getAuthHeader();

        // CSRF protects cookie-authenticated browser writes. Bearer-authenticated
        // SDK clients are not vulnerable to ambient-cookie CSRF, and linked app
        // APIs should not need to implement a duplicate `/csrf-token` route.
        const isStateChangingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
        const csrfToken = isStateChangingMethod && !authHeader ? await this.fetchCsrfToken() : null;

        // Determine if data is FormData using robust detection
        const isFormData = this.isFormData(data);

        // Make fetch request
        const controller = new AbortController();
        const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
        
        if (signal) {
          signal.addEventListener('abort', () => controller.abort());
        }

        // Build headers - start with defaults
        const headers: Record<string, string> = {
          'Accept': 'application/json',
        };

        // Only set Content-Type for non-FormData requests (FormData sets it automatically with boundary)
        if (!isFormData) {
          headers['Content-Type'] = 'application/json';
        }

        // Add authorization header if available
        if (authHeader) {
          headers['Authorization'] = authHeader;
        }

        // Add CSRF token header for state-changing requests
        if (csrfToken) {
          headers['X-CSRF-Token'] = csrfToken;
        }

        // Add native app header for React Native (required for CSRF validation)
        // Native apps can't persist cookies like browsers, so the server uses
        // header-only CSRF validation when this header is present
        if (isNativeApp && isStateChangingMethod) {
          headers['X-Native-App'] = 'true';
        }

        // Debug logging for CSRF issues, routed through SimpleLogger so it only
        // fires when consumers opt in via `enableLogging`.
        if (isStateChangingMethod) {
          this.logger.debug('CSRF Debug:', {
            url,
            method,
            isNativeApp,
            platformOS: getPlatformOS(),
            hasCsrfToken: !!csrfToken,
            csrfTokenLength: csrfToken?.length,
            hasNativeAppHeader: headers['X-Native-App'] === 'true',
          });
        }

        // Add X-Acting-As header for managed account identity delegation
        if (this._actingAsUserId) {
          headers['X-Acting-As'] = this._actingAsUserId;
        }

        // Merge custom headers if provided
        if (config.headers) {
          Object.entries(config.headers).forEach(([key, value]) => {
            // For FormData, explicitly remove Content-Type if user tries to set it
            // The browser/fetch API will set it automatically with the boundary
            if (isFormData && key.toLowerCase() === 'content-type') {
              this.logger.debug('Ignoring Content-Type header for FormData - will be set automatically');
              return;
            }
            headers[key] = value;
          });
        }

        const bodyValue = method !== 'GET' && data
            ? (isFormData ? data : JSON.stringify(data))
            : undefined;

        // React Native FormData workaround:
        // Expo SDK 56's "winter fetch" rejects RN file descriptors `{uri, type, name}`
        // in FormDataPart conversion (`Unsupported FormDataPart implementation`).
        // RN's native XMLHttpRequest handles those descriptors correctly, so we
        // route multipart uploads through XHR on RN only. JSON, text, etc. still
        // use fetch on every platform.
        const useXhrForUpload = isFormData && isReactNative() && typeof XMLHttpRequest !== 'undefined';

        const response = useXhrForUpload
          ? await this.uploadViaXHR(fullUrl, method, headers, bodyValue as FormData, controller.signal, timeout)
          : await fetch(fullUrl, {
              method,
              headers,
              body: bodyValue as BodyInit | null | undefined,
              signal: controller.signal,
              credentials: 'include', // Include cookies for cross-origin requests (CSRF, session)
            });

        if (timeoutId) clearTimeout(timeoutId);

        // Handle response
        if (!response.ok) {
          // On 401, delegate refresh to AuthManager and retry once before
          // giving up. HttpService deliberately does not know any session
          // routes; the AuthManager is the single session authority.
          if (response.status === 401 && !config._isAuthRetry) {
            const refreshed = await this.refreshAccessToken('response-401');
            if (refreshed) {
              return this.request<T>({ ...config, _isAuthRetry: true, retry: false });
            }
            // Refresh failed or no token — clear tokens and stale CSRF
            this.tokenStore.clearTokens();
            this.tokenStore.clearCsrfToken();
            this.notifyTokenChange();
          }

          // On 403 with CSRF error, clear cached token and retry once
          if (response.status === 403 && !config._isCsrfRetry) {
            try {
              const clonedResponse = response.clone();
              const errBody = await clonedResponse.json() as { code?: string } | null;
              if (errBody?.code === 'CSRF_TOKEN_INVALID' || errBody?.code === 'CSRF_TOKEN_MISSING') {
                this.tokenStore.clearCsrfToken();
                return this.request<T>({ ...config, _isCsrfRetry: true, retry: false });
              }
            } catch {
              // Failed to parse error body — not a CSRF error
            }
          }

          // Try to parse error response (handle empty/malformed JSON)
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            try {
              const errorData = await response.json() as { message?: string; error?: string } | null;
              // Accept either structured error field from API responses.
              if (errorData?.message) {
                errorMessage = errorData.message;
              } else if (errorData?.error) {
                errorMessage = errorData.error;
              }
            } catch (parseError) {
              // Malformed JSON or empty response - use status text
              this.logger.warn('Failed to parse error response JSON:', parseError);
            }
          }

          const error = new Error(errorMessage) as Error & {
            status?: number;
            response?: { status: number; statusText: string }
          };
          error.status = response.status;
          error.response = { status: response.status, statusText: response.statusText };
          throw error;
        }

        // Handle different response types (optimized - read response once)
        const contentType = response.headers.get('content-type');
        let responseData: unknown;
        
        if (contentType && contentType.includes('application/json')) {
          // Use response.json() directly for better performance
          try {
            responseData = await response.json();
            // Handle null/undefined responses
            if (responseData === null || responseData === undefined) {
              responseData = null;
            } else {
              // Unwrap standardized API response format for JSON
              responseData = this.unwrapResponse(responseData);
            }
          } catch (parseError) {
            // Handle malformed JSON or empty responses gracefully
            // Note: Once response.json() is called, the body is consumed and cannot be read again
            // So we check the error type to determine if it's empty or malformed
            if (parseError instanceof SyntaxError) {
              this.logger.warn('Failed to parse JSON response (malformed or empty):', parseError);
              // SyntaxError typically means empty or malformed JSON
              // For empty responses, return null; for malformed JSON, throw descriptive error
              responseData = null; // Treat as empty response for safety
            } else {
              this.logger.warn('Failed to read response:', parseError);
              throw new Error('Failed to read response from server');
            }
          }
        } else if (contentType && (contentType.includes('application/octet-stream') || contentType.includes('image/') || contentType.includes('video/') || contentType.includes('audio/'))) {
          // For binary responses (blobs), return the blob directly without unwrapping
          responseData = await response.blob();
        } else {
          // For other responses, return as text
          const text = await response.text();
          responseData = text || null;
        }

        const duration = Date.now() - startTime;
        this.updateMetrics(true, duration);
        this.config.onRequestEnd?.(url, method, duration, true);

        return responseData as T;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        this.updateMetrics(false, duration);
        this.config.onRequestEnd?.(url, method, duration, false);
        this.config.onRequestError?.(url, method, error instanceof Error ? error : new Error(String(error)));
        
        // Handle AbortError specifically for better error messages
        if (error instanceof Error && error.name === 'AbortError') {
          throw handleHttpError(error);
        }
        
        throw handleHttpError(error);
      }
    };

    // Wrap with retry if enabled
    const requestWithRetry = retry
      ? () => retryAsync(requestFn, maxRetries, this.config.retryDelay || 1000)
      : requestFn;

    // Wrap with deduplication if enabled (use optimized key generation)
    const dedupeKey = deduplicate ? this.generateCacheKey(method, url, data || params) : null;
    const finalRequest = dedupeKey
      ? () => this.deduplicator.deduplicate(dedupeKey, requestWithRetry)
      : requestWithRetry;

    // Execute request (with queue if needed)
    const result = await this.requestQueue.enqueue(finalRequest);

    // Cache the result if caching is enabled
    if (cache && cacheKey && result) {
      this.cache.set(cacheKey, result, cacheTTL);
    }

    return result;
  }

  /**
   * Upload via XMLHttpRequest (React Native FormData workaround).
   *
   * Expo SDK 56's "winter fetch" cannot serialize RN file descriptors
   * (`{uri, type, name}`) — `convertFormDataAsync` rejects them as
   * `Unsupported FormDataPart implementation`. RN's native XHR streams
   * the file from disk correctly, so multipart uploads go through XHR
   * on RN only.
   *
   * Returns a standard `Response` so downstream parsing in `request()`
   * (status checks, 401/403 retries, JSON/blob/text parsing) is identical
   * to the fetch path.
   */
  private uploadViaXHR(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: FormData,
    abortSignal: AbortSignal,
    timeout: number,
  ): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      // withCredentials mirrors fetch's `credentials: 'include'` so the
      // session cookie and CSRF cookie continue to flow.
      xhr.withCredentials = true;

      // Forward headers but skip Content-Type — XHR sets the multipart
      // boundary automatically and overriding it breaks the upload.
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'content-type') continue;
        try {
          xhr.setRequestHeader(key, value);
        } catch (headerError) {
          // Some headers (e.g. forbidden header names) cannot be set —
          // log and continue rather than failing the whole upload.
          this.logger.warn('XHR setRequestHeader failed:', key, headerError);
        }
      }

      xhr.responseType = 'text';
      if (timeout > 0) {
        xhr.timeout = timeout;
      }

      const onAbort = (): void => {
        try { xhr.abort(); } catch { /* xhr already finished */ }
      };
      if (abortSignal.aborted) {
        reject(new DOMException('The user aborted a request.', 'AbortError'));
        return;
      }
      abortSignal.addEventListener('abort', onAbort);

      const cleanup = (): void => {
        abortSignal.removeEventListener('abort', onAbort);
      };

      xhr.onload = (): void => {
        cleanup();
        const responseHeaders = HttpService.parseXHRHeaders(xhr.getAllResponseHeaders());
        resolve(new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: responseHeaders,
        }));
      };
      xhr.onerror = (): void => {
        cleanup();
        reject(new TypeError('Network request failed'));
      };
      xhr.ontimeout = (): void => {
        cleanup();
        reject(new DOMException('The request timed out.', 'TimeoutError'));
      };
      xhr.onabort = (): void => {
        cleanup();
        reject(new DOMException('The user aborted a request.', 'AbortError'));
      };

      xhr.send(body);
    });
  }

  /**
   * Parse raw header string from `XMLHttpRequest.getAllResponseHeaders()`
   * into a `Headers`-compatible object.
   */
  private static parseXHRHeaders(rawHeaders: string): Headers {
    const headers = new Headers();
    if (!rawHeaders) return headers;
    // RFC 7230 line terminator is CRLF; some XHR implementations use LF only.
    const lines = rawHeaders.trim().split(/\r?\n/);
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex <= 0) continue;
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key) {
        try {
          headers.append(key, value);
        } catch {
          // Invalid header name/value — skip.
        }
      }
    }
    return headers;
  }

  /**
   * Delimiter that separates the logical `method:url[:data]` portion of a
   * cache key from its identity suffix. Always APPENDED, never used to parse
   * a key apart, so the `method:url` prefix stays intact for
   * `clearCacheByPrefix` sweeps and `clearCacheEntry` base-key matching.
   * The `clearCacheEntry` callsites all pass fixed, dataless logical keys
   * (`GET:/users/<id>`, `GET:/session/user/<sessionId>`,
   * `GET:/fedcm/me/authorized-apps`), so this readable suffix can never be
   * ambiguous with a serialized request body.
   */
  private static readonly CACHE_IDENTITY_DELIM = ' id=';

  /**
   * Derive a stable, non-sensitive identity discriminator for cache scoping.
   *
   * The GET-response cache MUST be partitioned by caller identity: endpoints
   * with optional auth (e.g. `GET /profiles/recommendations`) return different
   * content for an anonymous vs an authenticated caller, and per-user content
   * for different authenticated users. Keying solely on `method:url:data`
   * (the previous behavior) let an anonymous response be served to an
   * authenticated caller — surfacing as "Who to follow" recommending accounts
   * the user already follows after a cold-boot session restore.
   *
   * We use the access token's decoded user id (`userId || id`) rather than the
   * raw JWT so the token never lands in a cache key (no token leakage through
   * any cache-key logging, no key bloat). The acting-as id is folded in because
   * managed-account responses differ per acting identity — and `X-Acting-As`
   * already changes the server response for the same bearer token. Falls back
   * to `'anon'` when there is no token, and to a short FNV-1a hash of the token
   * only if it is present but cannot be decoded (degraded but still partitioned,
   * never colliding anon with authed).
   */
  private computeIdentityTag(): string {
    const accessToken = this.tokenStore.getAccessToken();
    let principal = 'anon';
    if (accessToken) {
      try {
        const decoded = jwtDecode<JwtPayload>(accessToken);
        principal = decoded.userId || decoded.id || `t${fnv1a32(accessToken)}`;
      } catch {
        // Undecodable token — still partition it away from anon and from
        // other tokens via a hash. Never silently fall back to 'anon'.
        principal = `t${fnv1a32(accessToken)}`;
      }
    }
    return this._actingAsUserId ? `${principal}~as${this._actingAsUserId}` : principal;
  }

  /**
   * Generate cache key efficiently
   * Uses a content-addressed hash for large payloads so two requests with
   * the same shape but different values never collide on the same key
   * (which would silently serve stale data — e.g. paginated search results,
   * large object updates).
   *
   * The key is identity-scoped: the logical `method:url[:data]` portion is
   * suffixed with ` id=<identityTag>` so two callers with different
   * identities (anon vs authed, or two different users) never share an entry.
   * The identity tag is placed at the END so the key still STARTS with
   * `method:url`, preserving the prefix-based invalidation in
   * `clearCacheByPrefix` (e.g. `GET:/session/user/`) and the base-key matching
   * in `clearCacheEntry`.
   */
  private generateCacheKey(method: string, url: string, data?: unknown): string {
    return `${this.generateBaseCacheKey(method, url, data)}${HttpService.CACHE_IDENTITY_DELIM}${this.computeIdentityTag()}`;
  }

  /**
   * Build the identity-agnostic portion of a cache key (`method:url[:data]`).
   * Kept separate so identity scoping is applied in exactly one place
   * (`generateCacheKey`) and cannot drift between the cache and dedupe paths.
   */
  private generateBaseCacheKey(method: string, url: string, data?: unknown): string {
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
      return `${method}:${url}`;
    }

    // For small objects, the full serialization IS the key — fastest and
    // guaranteed to be content-addressed.
    const dataStr = JSON.stringify(data);
    if (dataStr.length < 1000) {
      return `${method}:${url}:${dataStr}`;
    }

    // For large payloads, hash the full serialized string so the key remains
    // content-addressed (any byte change yields a different hash). Previous
    // implementation hashed `keys + length` which collided for any two
    // payloads with the same top-level keys and serialized length.
    return `${method}:${url}:${fnv1a32(dataStr)}`;
  }

  /**
   * Build full URL with query params
   */
  private buildURL(url: string, params?: Record<string, unknown>): string {
    const base = /^https?:\/\//i.test(url)
      ? url
      : `${this.baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
    
    if (!params || Object.keys(params).length === 0) {
      return base;
    }

    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `${base}${base.includes('?') ? '&' : '?'}${queryString}` : base;
  }

  /**
   * Fetch CSRF token from server (with deduplication)
   * Required for state-changing requests (POST, PUT, PATCH, DELETE)
   */
  private async fetchCsrfToken(): Promise<string | null> {
    // Return cached token if available
    const cachedToken = this.tokenStore.getCsrfToken();
    if (cachedToken) {
      this.logger.debug('Using cached CSRF token');
      return cachedToken;
    }

    // Deduplicate concurrent CSRF token fetches
    const existingPromise = this.tokenStore.getCsrfTokenFetchPromise();
    if (existingPromise) {
      this.logger.debug('Waiting for existing CSRF fetch');
      return existingPromise;
    }

    const fetchPromise = (async () => {
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          this.logger.debug('Fetching CSRF token from:', `${this.baseURL}/csrf-token`, `(attempt ${attempt})`);

          // Use AbortController for timeout (more compatible than AbortSignal.timeout)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(`${this.baseURL}/csrf-token`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            credentials: 'include', // Required to receive and send cookies
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          this.logger.debug('CSRF fetch response:', response.status, response.ok);

          if (response.ok) {
            const data = await response.json() as { csrfToken?: string };
            this.logger.debug('CSRF response data:', data);
            const token = data.csrfToken || null;
            this.tokenStore.setCsrfToken(token);
            this.logger.debug('CSRF token fetched');
            return token;
          }

          // Also check response header for CSRF token
          const headerToken = response.headers.get('X-CSRF-Token');
          if (headerToken) {
            this.tokenStore.setCsrfToken(headerToken);
            this.logger.debug('CSRF token from header');
            return headerToken;
          }

          this.logger.debug('CSRF fetch failed with status:', response.status);
          this.logger.warn('Failed to fetch CSRF token:', response.status);
        } catch (error) {
          this.logger.debug('CSRF fetch error:', error);
          this.logger.warn('CSRF token fetch error:', error);
        }
        // Wait before retry (500ms)
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      return null;
    })().finally(() => {
      this.tokenStore.setCsrfTokenFetchPromise(null);
    });

    this.tokenStore.setCsrfTokenFetchPromise(fetchPromise);
    return fetchPromise;
  }

  /**
   * Get auth header with automatic token refresh
   */
  private async getAuthHeader(): Promise<string | null> {
    const accessToken = this.syncAccessTokenFromProvider();
    if (!accessToken) {
      return null;
    }

    try {
      const decoded = jwtDecode<JwtPayload>(accessToken);
      const currentTime = Math.floor(Date.now() / 1000);

      // If token expires in less than 60 seconds, refresh it
      if (decoded.exp && decoded.exp - currentTime < 60) {
        const refreshed = await this.refreshAccessToken('preflight');
        if (refreshed) return `Bearer ${refreshed}`;
        if (decoded.exp > currentTime) {
          return `Bearer ${accessToken}`;
        }
        // Refresh failed — don't use an expired token (would cause 401 loop)
        return null;
      }

      return `Bearer ${accessToken}`;
    } catch (error) {
      this.logger.error('Error processing token:', error);
      return null;
    }
  }

  async refreshAccessToken(reason: AuthRefreshReason): Promise<string | null> {
    if (!this.authRefreshHandler) {
      return null;
    }

    if (Date.now() < this.tokenRefreshCooldownUntil) {
      return null;
    }

    if (!this.tokenRefreshPromise) {
      this.tokenRefreshPromise = this.authRefreshHandler(reason)
        .then((newToken) => {
          if (!newToken) {
            this.tokenRefreshCooldownUntil = Date.now() + 15000;
            return null;
          }
          if (this.tokenStore.getAccessToken() !== newToken) {
            this.tokenStore.setTokens(newToken);
            this.notifyTokenChange();
          }
          this.logger.debug('Token refreshed via AuthManager');
          return newToken;
        })
        .catch((error) => {
          this.logger.warn('Token refresh failed:', error);
          this.tokenRefreshCooldownUntil = Date.now() + 15000;
          return null;
        })
        .finally(() => {
          this.tokenRefreshPromise = null;
        });
    }

    return this.tokenRefreshPromise;
  }

  /**
   * Unwrap standardized API response format
   */
  private unwrapResponse(responseData: unknown): unknown {
    // Handle paginated responses: { data: [...], pagination: {...} }
    if (responseData && typeof responseData === 'object' && 'data' in responseData && 'pagination' in responseData) {
      return responseData;
    }
    
    // Handle regular success responses: { data: ... }
    if (responseData && typeof responseData === 'object' && 'data' in responseData && !Array.isArray(responseData)) {
      return responseData.data;
    }
    
    // Return as-is for responses that don't use sendSuccess wrapper
    return responseData;
  }

  /**
   * Update request metrics
   */
  private updateMetrics(success: boolean, duration: number): void {
    this.requestMetrics.totalRequests++;
    if (success) {
      this.requestMetrics.successfulRequests++;
    } else {
      this.requestMetrics.failedRequests++;
    }

    const alpha = 0.1;
    this.requestMetrics.averageResponseTime =
      this.requestMetrics.averageResponseTime * (1 - alpha) + duration * alpha;
  }

  // Convenience methods
  async get<T = unknown>(url: string, config?: Omit<RequestConfig, 'method' | 'url'>): Promise<T> {
    return this.request<T>({ method: 'GET', url, ...config });
  }

  async post<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'url' | 'data'>): Promise<T> {
    return this.request<T>({ method: 'POST', url, data, ...config });
  }

  async put<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'url' | 'data'>): Promise<T> {
    return this.request<T>({ method: 'PUT', url, data, ...config });
  }

  async patch<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'url' | 'data'>): Promise<T> {
    return this.request<T>({ method: 'PATCH', url, data, ...config });
  }

  async delete<T = unknown>(url: string, config?: Omit<RequestConfig, 'method' | 'url'>): Promise<T> {
    return this.request<T>({ method: 'DELETE', url, ...config });
  }

  // Acting-as identity management (managed accounts)
  setActingAs(userId: string | null): void {
    this._actingAsUserId = userId;
  }

  getActingAs(): string | null {
    return this._actingAsUserId;
  }

  // Token management
  setTokens(accessToken: string): void {
    this.tokenStore.setTokens(accessToken);
    this.notifyTokenChange();
  }

  setAuthRefreshHandler(handler: AuthRefreshHandler | null): void {
    this.authRefreshHandler = handler;
  }

  setAccessTokenProvider(provider: AccessTokenProvider | null): void {
    this.accessTokenProvider = provider;
  }

  clearTokens(): void {
    this.tokenStore.clearTokens();
    this.tokenStore.clearCsrfToken();
    // Drop the response cache on logout. The cache is identity-scoped, so a
    // different user could never read these entries, but a logged-out client
    // must not keep the previous session's personalized data resident in
    // memory (privacy + correct logout semantics). We do NOT clear on
    // `setTokens` because a silent token refresh re-issues a token for the
    // SAME user — the identity tag is unchanged and the warm cache is still
    // valid; clearing there would defeat caching as refreshes fire near
    // every token expiry.
    this.cache.clear();
    this.notifyTokenChange();
  }

  /**
   * Subscribe to access-token changes on this instance.
   *
   * Fires on every mutation of the access token — `setTokens`, `clearTokens`,
   * a successful silent refresh, and the internal 401-driven clear — passing
   * the resulting token (or `null` when cleared). Returns an unsubscribe
   * function; call it on teardown to avoid leaks.
   *
   * This is the single hook downstream code (e.g. @oxyhq/services' OxyProvider)
   * uses to keep an external token sink — such as the shared `oxyClient`
   * singleton — in lockstep with the active session, regardless of which code
   * path mutated the token.
   */
  addTokenChangeListener(listener: (accessToken: string | null) => void): () => void {
    this._tokenChangeListeners.add(listener);
    return () => {
      this._tokenChangeListeners.delete(listener);
    };
  }

  /**
   * Notify all token-change listeners with the current access token.
   * Listener exceptions are isolated so one bad subscriber cannot break token
   * propagation to the others or to the calling auth flow.
   * @internal
   */
  private notifyTokenChange(): void {
    if (this._tokenChangeListeners.size === 0) return;
    const accessToken = this.tokenStore.getAccessToken();
    for (const listener of this._tokenChangeListeners) {
      try {
        listener(accessToken);
      } catch (error) {
        this.logger.error('Token change listener threw:', error);
      }
    }
  }

  getAccessToken(): string | null {
    return this.tokenStore.getAccessToken();
  }

  hasAccessToken(): boolean {
    return this.tokenStore.hasAccessToken();
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  // Cache management
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Delete a cache entry by its LOGICAL key (`method:url[:data]`).
   *
   * Because the response cache is identity-scoped — stored keys carry an
   * ` id=<identityTag>` suffix — a caller passing the logical key
   * `GET:/users/<id>` must invalidate that resource for EVERY identity that
   * cached it (e.g. `updateProfile` busting a user representation that may be
   * cached under both the owner's id and a viewer's id). We therefore delete
   * the exact key (for any pre-existing un-suffixed entries) AND every
   * identity-scoped variant `<key> id=*`.
   */
  clearCacheEntry(key: string): void {
    this.cache.delete(key);
    const identityVariantPrefix = `${key}${HttpService.CACHE_IDENTITY_DELIM}`;
    for (const existing of this.cache.keys()) {
      if (existing.startsWith(identityVariantPrefix)) {
        this.cache.delete(existing);
      }
    }
  }

  /**
   * Delete every cache entry whose key starts with `prefix`.
   *
   * Used by mutations that don't know the exact downstream cache keys —
   * e.g. `updateProfile` invalidating all `GET:/session/user/*` entries
   * without having to track every active session ID. Returns the number of
   * deleted entries (for observability in tests).
   */
  clearCacheByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  getCacheStats() {
    const cacheStats = this.cache.getStats();
    const total = this.requestMetrics.cacheHits + this.requestMetrics.cacheMisses;
    return {
      size: cacheStats.size,
      hits: this.requestMetrics.cacheHits,
      misses: this.requestMetrics.cacheMisses,
      hitRate: total > 0 ? this.requestMetrics.cacheHits / total : 0,
    };
  }

  getMetrics() {
    return { ...this.requestMetrics };
  }

  // Test-only utility — clears tokens on this instance
  __resetTokensForTests(): void {
    this.tokenStore.clearTokens();
    this.tokenStore.clearCsrfToken();
  }
}
