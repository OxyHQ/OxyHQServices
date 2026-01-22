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

  const base64UrlEncode = (data: string | Buffer) => {
    const str = typeof data === 'string' ? data : data.toString('base64');
    return Buffer.from(typeof data === 'string' ? data : '')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
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
  try {
    // Parse request body
    const body = await request.json();
    const { account_id, client_id, disclosure_text_shown } = body;
    // nonce can be at top level or in params object (Chrome 145+)
    const nonce = body.nonce || body.params?.nonce;

    if (!account_id || !client_id) {
      return NextResponse.json(
        { error: 'account_id and client_id are required' },
        { status: 400 }
      );
    }

    // Verify session
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      );
    }

    // Fetch user to verify account_id matches session
    let user: User;
    try {
      user = await apiGet<User>(`/api/session/user/${sessionCookie.value}`);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      );
    }

    // Verify account_id matches the authenticated user
    if (user.id !== account_id) {
      return NextResponse.json(
        { error: 'Account ID mismatch' },
        { status: 403 }
      );
    }

    // Generate ID token
    const token = generateIdToken(user.id, client_id, nonce);

    // Return the ID assertion
    return NextResponse.json(
      { token },
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
          'Access-Control-Allow-Credentials': 'true',
          // Confirm login status for FedCM
          'Set-Login': 'logged-in',
        },
      }
    );
  } catch (error) {
    console.error('[FedCM Assertion] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
