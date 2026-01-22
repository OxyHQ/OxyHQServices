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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

/**
 * Get CORS headers for FedCM responses
 * IMPORTANT: When Access-Control-Allow-Credentials is true,
 * Access-Control-Allow-Origin CANNOT be '*' - must be specific origin
 */
function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  // FedCM requests always include an origin header
  // If no origin, use a safe default (won't work with credentials but prevents errors)
  const allowOrigin = origin || 'https://oxy.so';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Create a JSON response with proper FedCM headers
 */
function createFedCMResponse(
  data: { accounts: any[] },
  request: NextRequest,
  options: { loggedIn?: boolean } = {}
): NextResponse {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getCorsHeaders(request),
  };

  // Set login status for FedCM - critical for silent mediation to work
  // This tells the browser the user is logged in at this IdP
  if (options.loggedIn && data.accounts.length > 0) {
    headers['Set-Login'] = 'logged-in';
  }

  return NextResponse.json(data, { headers });
}

export async function GET(request: NextRequest) {
  // Validate this is a FedCM request (optional but recommended for security)
  const secFetchDest = request.headers.get('sec-fetch-dest');
  if (secFetchDest && secFetchDest !== 'webidentity') {
    // Not a FedCM request - could be a regular API call or CSRF attempt
    console.warn('[FedCM Accounts] Non-FedCM request blocked:', secFetchDest);
    return createFedCMResponse({ accounts: [] }, request);
  }

  try {
    // Check for oxy_session_id cookie
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie) {
      // No session - return empty accounts list (not an error)
      return createFedCMResponse({ accounts: [] }, request);
    }

    // Fetch user data from session
    let user: User;
    try {
      user = await apiGet<User>(`/api/session/user/${sessionCookie.value}`);
    } catch (error) {
      // Invalid session - return empty accounts (not an error for FedCM)
      console.log('[FedCM Accounts] Session lookup failed, returning empty accounts');
      return createFedCMResponse({ accounts: [] }, request);
    }

    // Approved clients for auto sign-in (no UI prompt)
    // SECURITY: Only pre-approved Oxy ecosystem domains are allowed
    // Do NOT dynamically add arbitrary origins
    const APPROVED_CLIENTS = [
      'https://homiio.com',
      'https://mention.earth',
      'https://alia.onl',
      'https://oxy.so',
      'https://accounts.oxy.so',
      'https://auth.oxy.so',
      'https://api.oxy.so',
      ...(process.env.NODE_ENV === 'development' ? [
        'http://localhost:3000',
        'http://localhost:8081',
      ] : []),
    ];

    // Return account information
    const accounts = [
      {
        id: user.id,
        name: user.username,
        email: user.email,
        picture: user.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`,
        // List of origins approved for auto sign-in (no UI prompt)
        approved_clients: APPROVED_CLIENTS,
      },
    ];

    console.log('[FedCM Accounts] Returning account for user:', user.id);
    return createFedCMResponse({ accounts }, request, { loggedIn: true });
  } catch (error) {
    // IMPORTANT: Return 200 with empty accounts instead of 500
    // FedCM interprets 500 as network error and shows "Check your internet connection"
    console.error('[FedCM Accounts] Unexpected error:', error);
    return createFedCMResponse({ accounts: [] }, request);
  }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowOrigin = origin || 'https://oxy.so';

  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Sec-Fetch-Dest',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
