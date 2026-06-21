/**
 * Module mocks for `bun test`. Imported BEFORE any component that pulls a
 * native-only Bloom subpath (e.g. `@oxyhq/bloom/avatar` or `@oxyhq/bloom/button`,
 * which transitively require `react-native` — a module bun cannot parse in a
 * node test environment). Keep this file dep-free — its job is solely to stub
 * native-only modules with web-safe surrogates.
 */
import { mock } from "bun:test"
import React from "react"

mock.module("@oxyhq/bloom/avatar", () => ({
    Avatar: ({ source }: { source?: string }) =>
        React.createElement("span", { "data-avatar-source": source ?? "" }),
}))

// Web-safe surrogate for the Bloom (react-native) Button. Renders a real
// <button> and maps `onPress` → `onClick` so component tests can exercise the
// markup/interaction without loading `react-native`. Mirrors the prop surface
// the auth app consumes (variant/size/loading/disabled/icon/children).
mock.module("@oxyhq/bloom/button", () => {
    const Button = ({
        children,
        icon,
        onPress,
        disabled,
        loading,
        accessibilityLabel,
        testID,
    }: {
        children?: React.ReactNode
        icon?: React.ReactNode
        onPress?: () => void
        disabled?: boolean
        loading?: boolean
        accessibilityLabel?: string
        testID?: string
    }) =>
        React.createElement(
            "button",
            {
                type: "button",
                onClick: disabled || loading ? undefined : onPress,
                disabled: disabled || loading,
                "aria-label": accessibilityLabel,
                "aria-busy": loading || undefined,
                "data-testid": testID,
            },
            icon,
            children
        )
    return {
        Button,
        PrimaryButton: Button,
        SecondaryButton: Button,
        GhostButton: Button,
        TextButton: Button,
        IconButton: Button,
        InverseButton: Button,
    }
})
