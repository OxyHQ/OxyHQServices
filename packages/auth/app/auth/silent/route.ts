/**
 * Silent Authentication Endpoint
 *
 * This endpoint is loaded in a hidden iframe to check if the user has an active
 * session at auth.oxy.so. If yes, it automatically provides the session data
 * back to the parent window via postMessage.
 *
 * This enables seamless SSO across all Oxy domains without user interaction.
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
  [key: string]: any;
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('client_id');
  const nonce = request.nextUrl.searchParams.get('nonce');

  if (!clientId) {
    return new NextResponse('client_id parameter is required', { status: 400 });
  }

  // Validate client_id is a valid origin URL to prevent postMessage to arbitrary targets
  let clientOrigin: string;
  try {
    const parsed = new URL(clientId);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return new NextResponse('client_id must be a valid HTTP(S) origin', { status: 400 });
    }
    clientOrigin = parsed.origin;
  } catch {
    return new NextResponse('client_id must be a valid URL origin', { status: 400 });
  }

  // Check for session cookie
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  let sessionData: any = null;

  if (sessionCookie) {
    try {
      // Get access token from session
      const tokenResponse = await apiGet<{ accessToken: string; expiresAt: string }>(
        `/api/session/token/${sessionCookie.value}`
      );

      // Get user data
      const user = await apiGet<User>(`/api/session/user/${sessionCookie.value}`);

      sessionData = {
        sessionId: sessionCookie.value,
        accessToken: tokenResponse.accessToken,
        expiresAt: tokenResponse.expiresAt,
        user,
      };
    } catch (error) {
      // Session invalid or expired - will send null
      console.error('[Silent Auth] Session validation failed:', error);
    }
  }

  // Safely encode data as base64 to prevent script injection via </script> in JSON
  const payloadJson = JSON.stringify({
    sessionData,
    clientId,
    nonce,
    targetOrigin: clientOrigin,
  });
  const payloadBase64 = Buffer.from(payloadJson).toString('base64');

  // Return HTML that sends postMessage to parent
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Silent Authentication</title>
</head>
<body>
  <script>
    (function() {
      var payload = JSON.parse(atob("${payloadBase64}"));

      var message = {
        type: 'oxy_silent_auth',
        session: payload.sessionData,
        nonce: payload.nonce,
      };

      try {
        window.parent.postMessage(message, payload.targetOrigin);
      } catch (error) {
        console.error('[Silent Auth] Failed to send postMessage:', error);
      }
    })();
  </script>
</body>
</html>
  `.trim();

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      // Allow embedding in iframes from the validated client origin for silent auth
      'Content-Security-Policy': `frame-ancestors ${clientOrigin}`,
    },
  });
}
