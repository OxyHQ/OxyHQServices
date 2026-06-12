/**
 * Module mocks for `bun test`. Imported BEFORE any component that pulls
 * `@oxyhq/bloom/avatar` (which transitively requires `react-native`, a module
 * that bun cannot parse in a node test environment). Keep this file dep-free —
 * its job is solely to stub native-only modules with web-safe surrogates.
 */
import { mock } from "bun:test"
import React from "react"

mock.module("@oxyhq/bloom/avatar", () => ({
    Avatar: ({ source }: { source?: string }) =>
        React.createElement("span", { "data-avatar-source": source ?? "" }),
}))
