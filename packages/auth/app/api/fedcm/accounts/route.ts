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

export async function GET(request: NextRequest) {
  try {
    // Check for oxy_session_id cookie
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie) {
      // No session - return empty accounts list
      return NextResponse.json({ accounts: [] }, {
        headers: {
          'Content-Type': 'application/json',
          // FedCM requires specific CORS headers
          'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    // Fetch user data from session
    let user: User;
    try {
      user = await apiGet<User>(`/api/session/user/${sessionCookie.value}`);
    } catch (error) {
      // Invalid session - return empty accounts
      return NextResponse.json({ accounts: [] }, {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
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

    return NextResponse.json({ accounts }, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  } catch (error) {
    console.error('[FedCM Accounts] Error:', error);
    return NextResponse.json({ accounts: [] }, {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
