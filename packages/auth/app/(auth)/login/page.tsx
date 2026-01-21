import { LoginForm } from "@/components/login-form"

type LoginPageProps = {
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>
}

function getParam(
  params: Record<string, string | string[] | undefined> | undefined,
  key: string
) {
  const value = params?.[key]
  return typeof value === "string" ? value : undefined
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = searchParams
    ? await Promise.resolve(searchParams)
    : undefined
  const reset = getParam(resolvedSearchParams, "reset")
  const notice = reset ? "Password reset. Please sign in." : undefined

  return (
    <LoginForm
      error={getParam(resolvedSearchParams, "error")}
      notice={notice}
      sessionToken={getParam(resolvedSearchParams, "token")}
      redirectUri={getParam(resolvedSearchParams, "redirect_uri")}
      state={getParam(resolvedSearchParams, "state")}
    />
  )
}
