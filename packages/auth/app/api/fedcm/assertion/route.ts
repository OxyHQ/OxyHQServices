/**
 * FedCM ID Assertion Endpoint
 *
 * Issues ID tokens (JWTs) for authenticated users.
 * The browser calls this after the user approves the sign-in prompt.
 *
 * Spec: https://fedidcg.github.io/FedCM/#idp-api-id-assertion-endpoint
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { apiGet } from '@/lib/oxy-api';
import { SESSION_COOKIE_NAME } from '@/lib/oxy-api';
import * as crypto from 'crypto';
import { getFedCMCorsHeaders, getFedCMPreflightHeaders } from '@/lib/fedcm-cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shared secret for signing FedCM tokens - must match api.oxy.so
function getFedCMTokenSecret(): string {
  const secret = process.env.FEDCM_TOKEN_SECRET;
  if (!secret) {
    throw new Error('FEDCM_TOKEN_SECRET environment variable is required');
  }
  return secret;
}

interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

/**
 * Generate a signed ID token (JWT with HS256)
 */
function generateIdToken(userId: string, clientId: string, nonce?: string): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload = {
    iss: process.env.NEXT_PUBLIC_OXY_AUTH_URL || 'https://auth.oxy.so', // Issuer
    sub: userId, // Subject (user ID)
    aud: clientId, // Audience (client app)
    exp: Math.floor(Date.now() / 1000) + 300, // Expires in 5 minutes (short-lived for exchange)
    iat: Math.floor(Date.now() / 1000), // Issued at
    nonce: nonce || '', // Nonce for replay protection
  };

  const base64UrlEncodeJson = (obj: any) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const headerB64 = base64UrlEncodeJson(header);
  const payloadB64 = base64UrlEncodeJson(payload);
  const signatureInput = `${headerB64}.${payloadB64}`;

  // Sign with HMAC-SHA256
  const signature = crypto
    .createHmac('sha256', getFedCMTokenSecret())
    .update(signatureInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${headerB64}.${payloadB64}.${signature}`;
}

const isDev = process.env.NODE_ENV === 'development';

export async function POST(request: NextRequest) {
  const corsHeaders = getFedCMCorsHeaders(request);
  if (isDev) console.log('[FedCM Assertion] Request received from:', request.headers.get('origin'));

  // Validate this is a FedCM request (optional but recommended for security)
  const secFetchDest = request.headers.get('sec-fetch-dest');
  if (secFetchDest && secFetchDest !== 'webidentity') {
    console.warn('[FedCM Assertion] Non-FedCM request blocked:', secFetchDest);
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // FedCM sends data as application/x-www-form-urlencoded, NOT JSON
    // Parse the form data from the request body
    const contentType = request.headers.get('content-type') || '';
    let account_id: string | null = null;
    let client_id: string | null = null;
    let disclosure_text_shown: string | null = null;
    let nonce: string | null = null;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      account_id = formData.get('account_id') as string;
      client_id = formData.get('client_id') as string;
      disclosure_text_shown = formData.get('disclosure_text_shown') as string;
      nonce = formData.get('nonce') as string;
      if (isDev) console.log('[FedCM Assertion] Parsed form data:', { account_id, client_id, hasNonce: !!nonce, disclosure_text_shown });
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      account_id = body.account_id;
      client_id = body.client_id;
      disclosure_text_shown = body.disclosure_text_shown;
      // Prefer params.nonce (Chrome 145+), fallback to top-level nonce (older browsers)
      nonce = body.params?.nonce || body.nonce;
      if (isDev) console.log('[FedCM Assertion] Parsed JSON body:', { account_id, client_id, hasNonce: !!nonce, disclosure_text_shown });
    } else {
      // Try to parse as form data by default (FedCM standard)
      try {
        const text = await request.text();
        const params = new URLSearchParams(text);
        account_id = params.get('account_id');
        client_id = params.get('client_id');
        disclosure_text_shown = params.get('disclosure_text_shown');
        nonce = params.get('nonce');
        if (isDev) console.log('[FedCM Assertion] Parsed URL params:', { account_id, client_id, hasNonce: !!nonce, disclosure_text_shown });
      } catch (parseError) {
        if (isDev) console.log('[FedCM Assertion] Failed to parse body:', parseError);
      }
    }

    if (!account_id || !client_id) {
      return NextResponse.json(
        { error: 'account_id and client_id are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify session
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Fetch user to verify account_id matches session
    let user: User;
    try {
      user = await apiGet<User>(`/api/session/user/${sessionCookie.value}`);
    } catch (error) {
      if (isDev) console.log('[FedCM Assertion] Session lookup failed:', error);
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Verify account_id matches the authenticated user
    if (user.id !== account_id) {
      return NextResponse.json(
        { error: 'Account ID mismatch' },
        { status: 403, headers: corsHeaders }
      );
    }

    // Generate ID token
    const token = generateIdToken(user.id, client_id, nonce || undefined);
    if (isDev) console.log('[FedCM Assertion] Token generated for user:', user.id);

    // Return the ID assertion
    return NextResponse.json(
      { token },
      {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
          // Confirm login status for FedCM
          'Set-Login': 'logged-in',
        },
      }
    );
  } catch (error) {
    console.error('[FedCM Assertion] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const headers = getFedCMPreflightHeaders(request, 'POST, OPTIONS', 'Content-Type, Sec-Fetch-Dest');
  return new NextResponse(null, { status: 204, headers });
}
