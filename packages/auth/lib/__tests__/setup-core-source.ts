/**
 * Resolve the auth app's `@oxyhq/core` imports for `bun test` without a prior
 * workspace build.
 *
 * Auth component tests import `@oxyhq/core` at runtime (`login-form.tsx` →
 * `isOxyRpOrigin`, `hub-passkey.tsx` → `getAccountDisplayName`, i18n helpers,
 * etc.). The package `exports` point at `dist/`, so an unbuilt workspace fails
 * with `Cannot find module '@oxyhq/core'`.
 *
 * Importing the full `@oxyhq/core` entry from source is not viable here — it
 * transitively pulls optional RN modules. Instead, re-export only the small
 * pure helpers auth actually uses, via relative paths into `packages/core/src`.
 *
 * TEST-ONLY: never affects the Vite app build.
 */
import { mock } from "bun:test"
import { getCommonsApprovalBlockingReason } from "../../../core/src/utils/commonsApproval"
import { isOxyRpOrigin } from "../../../core/src/utils/webauthnOrigin"
import { getAccountDisplayName } from "../../../core/src/utils/accountUtils"
import { translate } from "../../../core/src/i18n"
import { getBaseLanguage, normalizeLocale } from "../../../core/src/utils/languageUtils"

mock.module("@oxyhq/core", () => ({
    isOxyRpOrigin,
    getAccountDisplayName,
    getCommonsApprovalBlockingReason,
    translate,
    getBaseLanguage,
    normalizeLocale,
}))
