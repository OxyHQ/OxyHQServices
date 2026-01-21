import { RecoverForm } from "@/components/recover-form"

type RecoverPageProps = {
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

export default async function RecoverPage({ searchParams }: RecoverPageProps) {
  const resolvedSearchParams = searchParams
    ? await Promise.resolve(searchParams)
    : undefined

  return (
    <RecoverForm
      error={getParam(resolvedSearchParams, "error")}
      step={getParam(resolvedSearchParams, "step")}
      identifier={getParam(resolvedSearchParams, "identifier")}
      devCode={getParam(resolvedSearchParams, "devCode")}
    />
  )
}
