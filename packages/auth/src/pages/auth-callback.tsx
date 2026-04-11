import { useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { LoadingSpinner } from "@/components/auth-form-layout"

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    const sessionId = searchParams.get("session_id")
    const accessToken = searchParams.get("access_token")
    const expiresAt = searchParams.get("expires_at")
    const state = searchParams.get("state")
    const error = searchParams.get("error")
    const errorDescription = searchParams.get("error_description")
    const redirectUri = searchParams.get("redirect_uri")

    if (!window.opener) {
      window.location.href = redirectUri || "/"
      return
    }

    let targetOrigin: string | null = null
    if (redirectUri) {
      try {
        targetOrigin = new URL(redirectUri).origin
      } catch {
        // Invalid redirect_uri
      }
    }

    if (!targetOrigin) return

    const response: Record<string, unknown> = { type: "oxy_auth_response", state }

    if (error) {
      response.error = errorDescription || error
    } else if (sessionId && accessToken) {
      response.session = {
        sessionId,
        accessToken,
        expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }
    } else {
      response.error = "No session data received"
    }

    try {
      window.opener.postMessage(response, targetOrigin)
    } catch {
      // Failed to send postMessage
    }

    const timeout = setTimeout(() => window.close(), 500)
    return () => clearTimeout(timeout)
  }, [searchParams])

  return <LoadingSpinner />
}
