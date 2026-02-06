/**
 * FedCM Login Status Endpoint
 *
 * This endpoint is used to signal to the browser that the user is logged in
 * at this IdP (auth.oxy.so). The browser's FedCM Login Status API only processes
 * the Set-Login header from top-level frame navigations, NOT from fetch/XHR.
 *
 * After a user logs in via the JSON API, the client should load this endpoint
 * in a hidden iframe to set the login status.
 *
 * @see https://fedidcg.github.io/FedCM/#login-status-api
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/oxy-api';
import { getFedCMCorsHeaders, getFedCMPreflightHeaders } from '@/lib/fedcm-cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  const hasSession = !!sessionCookie?.value;

  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login Status</title></head><body></body></html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Set-Login': hasSession ? 'logged-in' : 'logged-out',
        ...getFedCMCorsHeaders(request),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export async function OPTIONS(request: NextRequest) {
  const headers = getFedCMPreflightHeaders(request, 'GET, OPTIONS', 'Content-Type');
  return new NextResponse(null, { status: 204, headers });
}
