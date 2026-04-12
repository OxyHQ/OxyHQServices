import { Outlet, Link, useLocation } from "react-router-dom"
import { KeyRound, Monitor, Link2 } from "lucide-react"
import { Logo } from "@/components/logo"
import { cn } from "@/lib/utils"

const settingsLinks = [
    { to: "/settings/password", label: "Password", icon: KeyRound },
    { to: "/settings/sessions", label: "Sessions", icon: Monitor },
    { to: "/settings/linked-accounts", label: "Linked accounts", icon: Link2 },
]

export function SettingsLayout() {
    const location = useLocation()

    return (
        <div className="bg-background min-h-svh flex flex-col">
            <header className="border-b px-6 py-4">
                <div className="max-w-3xl mx-auto flex items-center gap-4">
                    <Link to="/login" className="flex items-center gap-2">
                        <Logo />
                        <span className="sr-only">Oxy</span>
                    </Link>
                    <h1 className="text-lg font-semibold">Account settings</h1>
                </div>
            </header>
            <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 flex gap-8">
                <nav className="hidden md:flex flex-col gap-1 w-48 shrink-0">
                    {settingsLinks.map(({ to, label, icon: Icon }) => (
                        <Link
                            key={to}
                            to={to}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                                location.pathname === to
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                        >
                            <Icon className="size-4" />
                            {label}
                        </Link>
                    ))}
                </nav>
                <main className="flex-1 min-w-0">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
