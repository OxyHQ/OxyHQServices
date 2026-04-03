import { useSearchParams } from "react-router-dom";
import { RecoverForm } from "@/components/recover-form";

export function RecoverPage() {
  const [searchParams] = useSearchParams();

  return (
    <RecoverForm
      error={searchParams.get("error") ?? undefined}
      step={searchParams.get("step") ?? undefined}
      identifier={searchParams.get("identifier") ?? undefined}
      devCode={searchParams.get("devCode") ?? undefined}
    />
  );
}
