"use client"

import { useEffect, useRef } from "react"

/**
 * FedCM Login Status Component
 *
 * This component ensures the browser's FedCM Login Status API knows
 * the user is logged in at auth.oxy.so. It loads a hidden iframe that
 * returns the Set-Login header, which is required for FedCM to work.
 *
 * The browser only processes Set-Login headers from top-level frame
 * navigations, not from fetch/XHR responses. By loading an iframe,
 * we can set the login status without requiring a full page navigation.
 *
 * This component should be included on pages where logged-in users visit,
 * ensuring their login status is kept up to date for cross-domain SSO.
 */
export function FedCMLoginStatus() {
    const hasSetStatus = useRef(false)

    useEffect(() => {
        // Only run once per page load
        if (hasSetStatus.current) return
        hasSetStatus.current = true

        // Load the login status endpoint in a hidden iframe
        // This signals to the browser's FedCM Login Status API
        // that the user is (or is not) logged in at this IdP
        const frame = document.createElement("iframe")
        frame.style.display = "none"
        frame.src = "/api/fedcm/login-status"
        document.body.appendChild(frame)

        // Clean up after a short delay
        const cleanup = setTimeout(() => {
            frame.remove()
        }, 2000)

        return () => {
            clearTimeout(cleanup)
            frame.remove()
        }
    }, [])

    return null
}
