/**
 * FedCM Token Exchange Endpoint
 *
 * Exchanges a FedCM ID token for an Oxy session with access token.
 * This is called by the client app after receiving the ID token from FedCM.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiGet, apiPost } from '@/lib/oxy-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionLoginResponse {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  accessToken?: string;
  user: {
    id: string;
    username: string;
    email: string;
    [key: string]: any;
  };
}

/**
 * Decode ID token (simple base64url decode)
 * In production, verify signature using public key
 */
function decodeIdToken(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const payload = parts[1];
    const decoded = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf-8');

    return JSON.parse(decoded);
  } catch (error) {
    throw new Error('Failed to decode ID token');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id_token } = body;

    if (!id_token) {
      return NextResponse.json(
        { error: 'id_token is required' },
        { status: 400 }
      );
    }

    // Decode and validate ID token
    let tokenPayload: any;
    try {
      tokenPayload = decodeIdToken(id_token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid ID token' },
        { status: 401 }
      );
    }

    // Validate token
    if (!tokenPayload.sub || !tokenPayload.aud) {
      return NextResponse.json(
        { error: 'Invalid token payload' },
        { status: 401 }
      );
    }

    // Check expiration
    if (tokenPayload.exp && tokenPayload.exp < Math.floor(Date.now() / 1000)) {
      return NextResponse.json(
        { error: 'Token expired' },
        { status: 401 }
      );
    }

    // Verify issuer
    if (tokenPayload.iss !== 'https://auth.oxy.so') {
      return NextResponse.json(
        { error: 'Invalid token issuer' },
        { status: 401 }
      );
    }

    const userId = tokenPayload.sub;

    // Fetch user data
    const user = await apiGet<any>(`/api/users/${userId}`);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Create a new session for this user
    // Note: In a real implementation, you might want to check for existing sessions
    // or create a session with the backend directly

    // For now, we'll construct a response with the user data
    // The client should already have or will create a session via the normal flow

    // Get or create session via the backend
    // This is a simplified version - you may need to call your actual session creation endpoint
    const sessionResponse: SessionLoginResponse = {
      sessionId: '', // Will be filled by backend
      deviceId: '',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      user,
    };

    // Note: In production, you should create an actual session here
    // For now, return user data and let the client handle session creation
    // Or integrate with your existing session creation flow

    return NextResponse.json(sessionResponse, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    console.error('[FedCM Exchange] Error:', error);
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
