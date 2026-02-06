/**
 * Shared FedCM CORS headers
 *
 * Reflects the request origin in Access-Control-Allow-Origin.
 * FedCM has built-in browser-level security (sec-fetch-dest: webidentity,
 * .well-known/web-identity, user consent UI) so a server-side origin
 * whitelist is unnecessary and creates friction for new Oxy ecosystem apps.
 */

import { NextRequest } from 'next/server';

/**
 * Get CORS headers for FedCM responses.
 * Reflects the request origin. Returns empty headers if no origin is present.
 * When Access-Control-Allow-Credentials is true, the origin must be explicit (not '*').
 */
export function getFedCMCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');

  if (!origin) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Build OPTIONS preflight response headers.
 */
export function getFedCMPreflightHeaders(
  request: NextRequest,
  methods: string,
  headers: string
): Record<string, string> {
  const origin = request.headers.get('origin');

  if (!origin) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': headers,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}
