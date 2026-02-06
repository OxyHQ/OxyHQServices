/**
 * FedCM Token Exchange Endpoint
 *
 * Exchanges a FedCM ID token for an Oxy session with access token.
 * This is called by the client app after receiving the ID token from FedCM.
 *
 * Note: The main exchange endpoint is at api.oxy.so/api/fedcm/exchange
 * This endpoint serves as a proxy for auth.oxy.so domain calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiPost, getForwardHeaders } from '@/lib/oxy-api';
import { getFedCMCorsHeaders, getFedCMPreflightHeaders } from '@/lib/fedcm-cors';

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
    [key: string]: string | number | boolean | null | undefined;
  };
}

/** Get validated CORS headers for FedCM responses */
function getCorsHeaders(request: NextRequest): Record<string, string> {
  return getFedCMCorsHeaders(request);
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    const body = await request.json();
    const { id_token } = body;

    if (!id_token) {
      return NextResponse.json(
        { error: 'id_token is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Forward to the main API exchange endpoint which handles signature verification
    // and session creation properly
    const sessionResponse = await apiPost<SessionLoginResponse>(
      '/api/fedcm/exchange',
      { id_token },
      { headers: getForwardHeaders(request) }
    );

    return NextResponse.json(sessionResponse, {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('[FedCM Exchange] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const headers = getFedCMPreflightHeaders(request, 'POST, OPTIONS', 'Content-Type');
  return new NextResponse(null, { status: 204, headers });
}
