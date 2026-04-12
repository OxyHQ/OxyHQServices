import { useState, useRef } from "react"
import { toast } from "sonner"
import { buildApiUrl } from "@/lib/oxy-api-client"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { PasswordInput } from "@/components/password-input"
import { PasswordRequirements } from "@/components/password-requirements"
import { validatePassword } from "@/lib/password-validation"
import { AuthFormHeader } from "@/components/auth-form-layout"

export function ChangePasswordPage() {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [localError, setLocalError] = useState<string | undefined>()
    const [success, setSuccess] = useState(false)
    const [newPassword, setNewPassword] = useState("")
    const [passwordTouched, setPasswordTouched] = useState(false)
    const formRef = useRef<HTMLFormElement>(null)

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLocalError(undefined)
        setIsSubmitting(true)

        const formData = new FormData(e.currentTarget)
        const currentPassword = String(formData.get("currentPassword") || "")

        const clientErrors = validatePassword(newPassword)
        if (clientErrors.length > 0) {
            setPasswordTouched(true)
            setIsSubmitting(false)
            return
        }

        try {
            const accessToken = sessionStorage.getItem("oxy_access_token")
            const headers: Record<string, string> = { "content-type": "application/json" }
            if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`

            const response = await fetch(buildApiUrl("/auth/change-password"), {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify({ currentPassword, newPassword }),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                const msg = typeof payload?.message === "string" ? payload.message : "Unable to change password"
                setLocalError(msg)
                setIsSubmitting(false)
                return
            }

            setSuccess(true)
            toast.success("Password changed", { description: "Your password has been updated successfully." })
            formRef.current?.reset()
            setNewPassword("")
            setPasswordTouched(false)
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : "Unable to change password")
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <AuthFormHeader title="Change password" description="Update your account password" />
            <form ref={formRef} onSubmit={handleSubmit}>
                <FieldGroup>
                    <Field data-invalid={localError ? true : undefined}>
                        <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
                        <PasswordInput id="currentPassword" name="currentPassword" placeholder="Current password" autoComplete="current-password" required />
                        {localError && <FieldError>{localError}</FieldError>}
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="newPassword">New password</FieldLabel>
                        <PasswordInput
                            id="newPassword"
                            name="newPassword"
                            placeholder="New password"
                            autoComplete="new-password"
                            required
                            value={newPassword}
                            onChange={(e) => {
                                setNewPassword(e.target.value)
                                if (!passwordTouched && e.target.value.length > 0) setPasswordTouched(true)
                            }}
                            onBlur={() => { if (newPassword.length > 0) setPasswordTouched(true) }}
                        />
                        {passwordTouched && <PasswordRequirements password={newPassword} />}
                    </Field>
                    <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? "Changing..." : "Change password"}
                    </Button>
                </FieldGroup>
            </form>
        </div>
    )
}
