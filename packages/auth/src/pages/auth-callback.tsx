import { useEffect, Suspense } from "react";
import { useSearchParams } from "react-router-dom";

function AuthCallbackContent() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const sendAuthResponse = () => {
      const state = searchParams.get("state");
      const sessionId = searchParams.get("session_id");
      const accessToken = searchParams.get("access_token");
      const expiresAt = searchParams.get("expires_at");
      const error = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");
      const redirectUri = searchParams.get("redirect_uri");

      if (!window.opener) {
        if (redirectUri) {
          window.location.href = redirectUri;
        } else {
          window.location.href = "/";
        }
        return;
      }

      let targetOrigin: string | null = null;

      if (redirectUri) {
        try {
          const url = new URL(redirectUri);
          targetOrigin = url.origin;
        } catch (e) {
          console.error("[AuthCallback] Invalid redirect_uri:", redirectUri);
        }
      }

      if (!targetOrigin) {
        console.error(
          "[AuthCallback] No valid redirect_uri provided - cannot send postMessage"
        );
        return;
      }

      const response: Record<string, unknown> = {
        type: "oxy_auth_response",
        state,
      };

      if (import.meta.env.DEV) {
        console.log("[AuthCallback] Params:", {
          sessionId,
          accessToken: accessToken ? "[present]" : "[missing]",
          state,
          redirectUri,
          targetOrigin,
        });
      }

      if (error) {
        response.error = errorDescription || error;
      } else if (sessionId && accessToken) {
        response.session = {
          sessionId,
          accessToken,
          expiresAt:
            expiresAt ||
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        };
      } else {
        console.error("[AuthCallback] Missing session data:", {
          sessionId: !!sessionId,
          accessToken: !!accessToken,
        });
        response.error = "No session data received";
      }

      try {
        window.opener.postMessage(response, targetOrigin);
      } catch (e) {
        console.error("[AuthCallback] Failed to send postMessage:", e);
      }

      setTimeout(() => {
        window.close();
      }, 500);
    };

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
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
        <p className="text-lg">Completing sign in...</p>
        <p className="text-sm text-gray-400 mt-2">
          This window will close automatically
        </p>
      </div>
    </div>
  );
}

const LoadingFallback = () => (
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
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
      <p className="text-lg">Completing sign in...</p>
      <p className="text-sm text-gray-400 mt-2">
        This window will close automatically
      </p>
    </div>
  </div>
);

export function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
