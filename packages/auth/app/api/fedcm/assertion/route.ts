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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

/**
 * Generate a simple ID token (JWT-like)
 * In production, you should use a proper JWT library with RS256 signing
 */
function generateIdToken(userId: string, clientId: string, nonce?: string): string {
  const header = {
    alg: 'none', // In production, use RS256 with proper key management
    typ: 'JWT',
  };

  const payload = {
    iss: 'https://auth.oxy.so', // Issuer
    sub: userId, // Subject (user ID)
    aud: clientId, // Audience (client app)
    exp: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
    iat: Math.floor(Date.now() / 1000), // Issued at
    nonce: nonce || '', // Nonce for replay protection
  };

  // Simple base64url encoding (production should use proper JWT library)
  const base64UrlEncode = (obj: any) => {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const headerB64 = base64UrlEncode(header);
  const payloadB64 = base64UrlEncode(payload);

  // In production, add proper signature here
  return `${headerB64}.${payloadB64}.`; // Empty signature (alg: none)
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { account_id, client_id, nonce, disclosure_text_shown } = body;

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
