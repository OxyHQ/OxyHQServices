const PRODUCTION_AUTH_BASE_URL = "https://api.oxy.so"
const LOCAL_AUTH_BASE_URL = "http://localhost:3001"

export function getAuthBaseUrl(): string {
  const envUrl =
    process.env.NEXT_PUBLIC_OXY_AUTH_URL ||
    process.env.NEXT_PUBLIC_OXY_API_URL
  const defaultUrl = process.env.NODE_ENV === 'production' ? PRODUCTION_AUTH_BASE_URL : LOCAL_AUTH_BASE_URL
  const baseUrl = (envUrl || defaultUrl).replace(/\/$/, "")

  if (baseUrl.endsWith("/auth")) {
    return baseUrl
  }

  return `${baseUrl}/auth`
}

export function buildAuthUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${getAuthBaseUrl()}${normalizedPath}`
}
