export const PASSWORD_RULES = [
    { test: (pw: string) => pw.length >= 12, label: "At least 12 characters" },
    { test: (pw: string) => /[A-Z]/.test(pw), label: "One uppercase letter (A-Z)" },
    { test: (pw: string) => /[a-z]/.test(pw), label: "One lowercase letter (a-z)" },
    { test: (pw: string) => /[0-9]/.test(pw), label: "One number (0-9)" },
    { test: (pw: string) => /[^A-Za-z0-9]/.test(pw), label: "One special character" },
]

export function validatePassword(pw: string): string[] {
    return PASSWORD_RULES.filter((rule) => !rule.test(pw)).map((rule) => rule.label)
}
