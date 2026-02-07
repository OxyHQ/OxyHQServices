/**
 * FedCM Debug Endpoint
 *
 * Use this to verify:
 * 1. If the session cookie is being sent correctly
 * 2. If the session is valid
 * 3. If the user lookup works
 *
 * Visit: https://auth.oxy.so/api/fedcm/debug
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { apiGet, SESSION_COOKIE_NAME } from '@/lib/oxy-api';
import { getFedCMCorsHeaders } from '@/lib/fedcm-cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Debug endpoint is disabled in production' },
      { status: 404 }
    );
  }

  const corsHeaders = getFedCMCorsHeaders(request);

  const debugInfo: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    origin: request.headers.get('origin'),
    secFetchDest: request.headers.get('sec-fetch-dest'),
  };

  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    debugInfo.allCookieNames = allCookies.map(c => c.name);
    debugInfo.sessionCookieFound = !!sessionCookie;
    debugInfo.sessionCookiePreview = sessionCookie
      ? `${sessionCookie.value.substring(0, 8)}...`
      : null;

    if (!sessionCookie) {
      debugInfo.error = 'No session cookie found';
      return NextResponse.json(debugInfo, { headers: corsHeaders });
    }

    try {
      const user = await apiGet<User>(`/session/user/${sessionCookie.value}`);
      debugInfo.userFound = true;
      debugInfo.user = {
        id: user.id,
        username: user.username,
        email: user.email,
      };
    } catch (error) {
      debugInfo.userFound = false;
      debugInfo.userLookupError = error instanceof Error ? error.message : String(error);
    }

    return NextResponse.json(debugInfo, { headers: corsHeaders });
  } catch (error) {
    debugInfo.error = error instanceof Error ? error.message : String(error);
    return NextResponse.json(debugInfo, { status: 500, headers: corsHeaders });
  }
}
