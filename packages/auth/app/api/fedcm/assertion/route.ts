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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shared secret for signing FedCM tokens - must match api.oxy.so
const FEDCM_TOKEN_SECRET = process.env.FEDCM_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET || 'fedcm-shared-secret';

/**
 * Get CORS headers for FedCM responses
 * IMPORTANT: When Access-Control-Allow-Credentials is true,
 * Access-Control-Allow-Origin CANNOT be '*' - must be specific origin
 */
function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  // FedCM requests always include an origin header
  const allowOrigin = origin || 'https://oxy.so';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
  };
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
    iss: 'https://auth.oxy.so', // Issuer
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
    .createHmac('sha256', FEDCM_TOKEN_SECRET)
    .update(signatureInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${headerB64}.${payloadB64}.${signature}`;
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  console.log('[FedCM Assertion] Request received from:', request.headers.get('origin'));

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
      console.log('[FedCM Assertion] Parsed form data:', { account_id, client_id, hasNonce: !!nonce, disclosure_text_shown });
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      account_id = body.account_id;
      client_id = body.client_id;
      disclosure_text_shown = body.disclosure_text_shown;
      // Prefer params.nonce (Chrome 145+), fallback to top-level nonce (older browsers)
      nonce = body.params?.nonce || body.nonce;
      console.log('[FedCM Assertion] Parsed JSON body:', { account_id, client_id, hasNonce: !!nonce, disclosure_text_shown });
    } else {
      // Try to parse as form data by default (FedCM standard)
      try {
        const text = await request.text();
        const params = new URLSearchParams(text);
        account_id = params.get('account_id');
        client_id = params.get('client_id');
        disclosure_text_shown = params.get('disclosure_text_shown');
        nonce = params.get('nonce');
        console.log('[FedCM Assertion] Parsed URL params:', { account_id, client_id, hasNonce: !!nonce, disclosure_text_shown });
      } catch (parseError) {
        console.log('[FedCM Assertion] Failed to parse body:', parseError);
      }
    }

    if (!account_id || !client_id) {
      console.log('[FedCM Assertion] Missing required fields');
      return NextResponse.json(
        { error: 'account_id and client_id are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify session
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    const allCookies = cookieStore.getAll();
    console.log('[FedCM Assertion] All cookies:', allCookies.map(c => c.name));
    console.log('[FedCM Assertion] Session cookie:', sessionCookie ? `${sessionCookie.value.substring(0, 8)}...` : 'NOT FOUND');

    if (!sessionCookie) {
      console.log('[FedCM Assertion] ERROR: No session cookie found');
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Fetch user to verify account_id matches session
    let user: User;
    try {
      console.log('[FedCM Assertion] Looking up user for session:', sessionCookie.value.substring(0, 8) + '...');
      user = await apiGet<User>(`/api/session/user/${sessionCookie.value}`);
      console.log('[FedCM Assertion] User found:', { id: user.id, username: user.username });
    } catch (error) {
      console.log('[FedCM Assertion] ERROR: Session lookup failed:', error);
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Verify account_id matches the authenticated user
    if (user.id !== account_id) {
      console.log('[FedCM Assertion] ERROR: Account ID mismatch:', { userId: user.id, accountId: account_id });
      return NextResponse.json(
        { error: 'Account ID mismatch' },
        { status: 403, headers: corsHeaders }
      );
    }

    // Generate ID token
    console.log('[FedCM Assertion] Generating token for user:', user.id, 'client:', client_id);
    const token = generateIdToken(user.id, client_id, nonce || undefined);
    console.log('[FedCM Assertion] Token generated successfully, length:', token.length);

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
  const origin = request.headers.get('origin');
  const allowOrigin = origin || 'https://oxy.so';

  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Sec-Fetch-Dest',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
