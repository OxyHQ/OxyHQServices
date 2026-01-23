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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Check if user has a session
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  const hasSession = !!sessionCookie?.value;

  // Create a minimal response that sets the login status
  // The Set-Login header tells the browser's FedCM Login Status API
  // whether the user is logged in at this IdP
  const response = new NextResponse(
    // Return a minimal HTML page for iframe loading
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login Status</title></head><body></body></html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        // Critical: This header is what the browser's FedCM system reads
        'Set-Login': hasSession ? 'logged-in' : 'logged-out',
        // Allow cross-origin requests from our domains
        'Access-Control-Allow-Origin': request.headers.get('origin') || 'https://oxy.so',
        'Access-Control-Allow-Credentials': 'true',
        // Prevent caching so login status is always fresh
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );

  console.log('[FedCM Login Status] Set-Login:', hasSession ? 'logged-in' : 'logged-out');

  return response;
}

// Handle preflight requests
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin || 'https://oxy.so',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
