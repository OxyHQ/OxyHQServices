/**
 * OAuth2 Popup Callback Page
 *
 * This page is loaded in the popup window after successful authentication.
 * It sends the authentication result back to the parent window via postMessage
 * and then closes itself.
 */

'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const sendAuthResponse = () => {
      // Extract auth parameters from URL
      const state = searchParams.get('state');
      const sessionId = searchParams.get('session_id');
      const accessToken = searchParams.get('access_token');
      const expiresAt = searchParams.get('expires_at');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');
      const redirectUri = searchParams.get('redirect_uri');

      // Check if we're in a popup window
      if (!window.opener) {
        // Not in popup - redirect to main app
        if (redirectUri) {
          window.location.href = redirectUri;
        } else {
          window.location.href = '/';
        }
        return;
      }

      // Determine target origin from redirect_uri or use the opener's origin
      let targetOrigin = '*'; // Fallback to wildcard (less secure)

      if (redirectUri) {
        try {
          const url = new URL(redirectUri);
          targetOrigin = url.origin;
        } catch (e) {
          console.error('Invalid redirect_uri:', redirectUri);
        }
      }

      // Build response object
      const response: any = {
        type: 'oxy_auth_response',
        state,
      };

      if (error) {
        response.error = errorDescription || error;
      } else if (sessionId && accessToken) {
        response.session = {
          sessionId,
          accessToken,
          expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        };
      } else {
        response.error = 'No session data received';
      }

      // Send message to parent window
      try {
        window.opener.postMessage(response, targetOrigin);
        console.log('[AuthCallback] Sent auth response to parent:', response.type);
      } catch (e) {
        console.error('[AuthCallback] Failed to send postMessage:', e);
      }

      // Close popup after a short delay (allows postMessage to be processed)
      setTimeout(() => {
        window.close();
      }, 500);
    };

    // Execute immediately
    sendAuthResponse();
  }, [searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="text-center">
        <div className="mb-4">
          <svg
            className="animate-spin h-12 w-12 mx-auto text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
        <p className="text-lg">Completing sign in...</p>
        <p className="text-sm text-gray-400 mt-2">This window will close automatically</p>
      </div>
    </div>
  );
}
