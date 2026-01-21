import { SignUpForm } from "@/components/sign-up-form"

type SignUpPageProps = {
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

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const resolvedSearchParams = searchParams
    ? await Promise.resolve(searchParams)
    : undefined

  return (
    <SignUpForm
      error={getParam(resolvedSearchParams, "error")}
      sessionToken={getParam(resolvedSearchParams, "token")}
      redirectUri={getParam(resolvedSearchParams, "redirect_uri")}
      state={getParam(resolvedSearchParams, "state")}
    />
  )
}
