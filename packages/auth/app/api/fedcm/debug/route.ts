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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

export async function GET(request: NextRequest) {
  // Only available in development to prevent user data exposure in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Debug endpoint is disabled in production' },
      { status: 404 }
    );
  }

  const debugInfo: Record<string, any> = {
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
      return NextResponse.json(debugInfo, {
        headers: {
          'Access-Control-Allow-Origin': request.headers.get('origin') || 'https://auth.oxy.so',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    // Try to lookup the user
    try {
      const user = await apiGet<User>(`/api/session/user/${sessionCookie.value}`);
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

    return NextResponse.json(debugInfo, {
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    debugInfo.error = error instanceof Error ? error.message : String(error);
    return NextResponse.json(debugInfo, {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }
}
