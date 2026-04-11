import { Outlet, useLocation, useNavigationType, Link } from "react-router-dom"
import { Logo } from "@/components/logo"
import { TermsFooter } from "@/components/auth-form-layout"

export function AuthLayout() {
  const location = useLocation()
  const navigationType = useNavigationType()

  const direction = navigationType === "POP" ? "back" : "forward"
  const animationClass = direction === "forward" ? "auth-step-forward" : "auth-step-back"

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-md flex flex-col gap-6">
        <Link to="/login" className="flex items-center gap-2 font-medium">
          <Logo />
          <span className="sr-only">Oxy</span>
        </Link>

        <div key={location.pathname} className={animationClass}>
          <Outlet />
        </div>

        <TermsFooter />
      </div>
    </div>
  )
}
