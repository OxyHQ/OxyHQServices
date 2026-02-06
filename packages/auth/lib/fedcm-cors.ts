/**
 * Shared FedCM CORS origin validation
 *
 * Validates request origins against an allowlist before reflecting them
 * in Access-Control-Allow-Origin. This prevents unauthorized origins
 * from obtaining FedCM ID tokens or user account information.
 */

import { NextRequest } from 'next/server';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://oxy.so',
  'https://accounts.oxy.so',
  'https://auth.oxy.so',
  'https://api.oxy.so',
  'https://homiio.com',
  'https://mention.earth',
  'https://alia.onl',
];

const DEV_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081',
];

function getAllowedOrigins(): string[] {
  const envOrigins = process.env.FEDCM_ALLOWED_ORIGINS
    ? process.env.FEDCM_ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const devOrigins = process.env.NODE_ENV === 'development' ? DEV_ALLOWED_ORIGINS : [];

  return [...DEFAULT_ALLOWED_ORIGINS, ...envOrigins, ...devOrigins];
}

function isOriginAllowed(origin: string): boolean {
  return getAllowedOrigins().includes(origin);
}

/**
 * Get CORS headers for FedCM responses with origin validation.
 * Returns headers only if the request origin is in the allowlist.
 * When Access-Control-Allow-Credentials is true, the origin must be explicit (not '*').
 */
export function getFedCMCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');

  if (!origin || !isOriginAllowed(origin)) {
    // Return restrictive default — no Access-Control-Allow-Origin means
    // the browser will block the response for cross-origin callers.
    return {};
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Build OPTIONS preflight response headers with origin validation.
 */
export function getFedCMPreflightHeaders(
  request: NextRequest,
  methods: string,
  headers: string
): Record<string, string> {
  const origin = request.headers.get('origin');

  if (!origin || !isOriginAllowed(origin)) {
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
