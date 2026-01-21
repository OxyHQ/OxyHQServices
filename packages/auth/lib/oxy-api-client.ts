const DEFAULT_AUTH_BASE_URL = "http://localhost:3001"

export function getAuthBaseUrl(): string {
  const envUrl =
    process.env.NEXT_PUBLIC_OXY_AUTH_URL ||
    process.env.NEXT_PUBLIC_OXY_API_URL
  const baseUrl = (envUrl || DEFAULT_AUTH_BASE_URL).replace(/\/$/, "")

  if (baseUrl.endsWith("/auth")) {
    return baseUrl
  }

  return `${baseUrl}/auth`
}

export function buildAuthUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${getAuthBaseUrl()}${normalizedPath}`
}
