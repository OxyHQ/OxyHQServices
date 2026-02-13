/**
 * FedCM Accounts Endpoint
 *
 * Returns the list of accounts that the user is currently signed in with.
 * This is called by the browser to populate the FedCM sign-in prompt.
 *
 * Spec: https://fedidcg.github.io/FedCM/#idp-api-accounts-endpoint
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
  avatar?: string;
  name?: {
    first?: string;
    last?: string;
  };
}

function getAvatarUrl(fileId: string): string {
  return `https://cloud.oxy.so/assets/${encodeURIComponent(fileId)}/stream?variant=thumb`;
}

function getDisplayName(user: User): string {
  if (user.name?.first && user.name?.last) {
    return `${user.name.first} ${user.name.last}`;
  }
  return user.username;
}

function createFedCMResponse(
  data: { accounts: Array<Record<string, unknown>> },
  request: NextRequest,
  options: { loggedIn?: boolean } = {}
): NextResponse {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getFedCMCorsHeaders(request),
  };

  if (options.loggedIn && data.accounts.length > 0) {
    headers['Set-Login'] = 'logged-in';
  }

  return NextResponse.json(data, { headers });
}

const isDev = process.env.NODE_ENV === 'development';

export async function GET(request: NextRequest) {
  if (isDev) {
    console.log('[FedCM Accounts] Request received from:', request.headers.get('origin'));
    console.log('[FedCM Accounts] sec-fetch-dest:', request.headers.get('sec-fetch-dest'));
  }

  const secFetchDest = request.headers.get('sec-fetch-dest');
  if (secFetchDest && secFetchDest !== 'webidentity') {
    console.warn('[FedCM Accounts] Non-FedCM request blocked:', secFetchDest);
    return createFedCMResponse({ accounts: [] }, request);
  }

  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (isDev) {
      const allCookies = cookieStore.getAll();
      console.log('[FedCM Accounts] All cookies:', allCookies.map(c => c.name));
      console.log('[FedCM Accounts] Session cookie:', sessionCookie ? `${sessionCookie.value.substring(0, 8)}...` : 'NOT FOUND');
    }

    if (!sessionCookie) {
      return createFedCMResponse({ accounts: [] }, request);
    }

    let user: User;
    try {
      user = await apiGet<User>(`/session/user/${sessionCookie.value}`);
    } catch {
      return createFedCMResponse({ accounts: [] }, request);
    }

    // All Oxy ecosystem apps are auto-approved for sign-in.
    // The requesting origin is included so new apps work without config.
    const requestingOrigin = request.headers.get('origin');
    const approvedClients = requestingOrigin ? [requestingOrigin] : [];

    const accounts = [
      {
        id: user.id,
        name: getDisplayName(user),
        email: user.email,
        picture: user.avatar ? getAvatarUrl(user.avatar) : undefined,
        approved_clients: approvedClients,
        login_hints: [user.id, user.email, user.username].filter(Boolean),
      },
    ];

    if (isDev) {
      console.log('[FedCM Accounts] Returning account for user:', user.id);
      console.log('[FedCM Accounts] Requesting origin:', requestingOrigin);
    }
    return createFedCMResponse({ accounts }, request, { loggedIn: true });
  } catch (error) {
    console.error('[FedCM Accounts] Unexpected error:', error);
    return createFedCMResponse({ accounts: [] }, request);
  }
}

export async function OPTIONS(request: NextRequest) {
  const headers = getFedCMPreflightHeaders(request, 'GET, OPTIONS', 'Content-Type, Sec-Fetch-Dest');
  return new NextResponse(null, { status: 204, headers });
}
