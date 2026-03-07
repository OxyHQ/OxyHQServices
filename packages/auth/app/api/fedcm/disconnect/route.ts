/**
 * FedCM Disconnect Endpoint
 *
 * Called by the browser when IdentityCredential.disconnect() is invoked by an RP.
 * Signals that the RP no longer wants the user's account association.
 *
 * The browser sends: account_hint (string identifying the account to disconnect)
 * We return: { account_id: "..." } to confirm which account was disconnected.
 *
 * @see https://fedidcg.github.io/FedCM/#disconnect-endpoint
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { apiGet } from '@/lib/oxy-api';
import { SESSION_COOKIE_NAME } from '@/lib/oxy-api';
import { getFedCMCorsHeaders, getFedCMPreflightHeaders } from '@/lib/fedcm-cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface User {
  id: string;
  username: string;
  email: string;
}

const isDev = process.env.NODE_ENV === 'development';

export async function POST(request: NextRequest) {
  const corsHeaders = getFedCMCorsHeaders(request);

  const secFetchDest = request.headers.get('sec-fetch-dest');
  if (secFetchDest && secFetchDest !== 'webidentity') {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // Parse form data (FedCM sends application/x-www-form-urlencoded)
    let account_hint: string | null = null;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      account_hint = formData.get('account_hint') as string;
    } else {
      const text = await request.text();
      const params = new URLSearchParams(text);
      account_hint = params.get('account_hint');
    }

    if (isDev) {
      console.log('[FedCM Disconnect] account_hint:', account_hint);
    }

    // Verify session exists
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Fetch user to verify account
    let user: User;
    try {
      user = await apiGet<User>(`/session/user/${sessionCookie.value}`);
    } catch {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401, headers: corsHeaders }
      );
    }

    // If account_hint is provided and not wildcard, verify it matches
    if (account_hint && account_hint !== '*') {
      if (user.id !== account_hint && user.email !== account_hint && user.username !== account_hint) {
        return NextResponse.json(
          { error: 'Account hint mismatch' },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    if (isDev) {
      console.log('[FedCM Disconnect] Disconnected user:', user.id);
    }

    return NextResponse.json(
      { account_id: user.id },
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  } catch (error) {
    console.error('[FedCM Disconnect] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const headers = getFedCMPreflightHeaders(request, 'POST, OPTIONS', 'Content-Type, Sec-Fetch-Dest');
  return new NextResponse(null, { status: 204, headers });
}
