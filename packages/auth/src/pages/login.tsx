import { useSearchParams } from "react-router-dom";
import { LoginForm } from "@/components/login-form";

export function LoginPage() {
  const [searchParams] = useSearchParams();

  const reset = searchParams.get("reset");
  const notice = reset ? "Password reset. Please sign in." : undefined;

  return (
    <LoginForm
      error={searchParams.get("error") ?? undefined}
      notice={notice}
      sessionToken={searchParams.get("token") ?? undefined}
      redirectUri={searchParams.get("redirect_uri") ?? undefined}
      state={searchParams.get("state") ?? undefined}
      clientId={searchParams.get("client_id") ?? undefined}
      codeChallenge={searchParams.get("code_challenge") ?? undefined}
      codeChallengeMethod={searchParams.get("code_challenge_method") ?? undefined}
      scope={searchParams.get("scope") ?? undefined}
      loginHint={searchParams.get("login_hint") ?? undefined}
    />
  );
}
