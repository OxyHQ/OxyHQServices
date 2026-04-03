import { useSearchParams } from "react-router-dom";
import { SignUpForm } from "@/components/sign-up-form";

export function SignUpPage() {
  const [searchParams] = useSearchParams();

  return (
    <SignUpForm
      error={searchParams.get("error") ?? undefined}
      sessionToken={searchParams.get("token") ?? undefined}
      redirectUri={searchParams.get("redirect_uri") ?? undefined}
      state={searchParams.get("state") ?? undefined}
    />
  );
}
