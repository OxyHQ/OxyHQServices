/**
 * Unit tests for the scoped Bloom color preset utilities.
 *
 * The chooser hover-theming relies on a clean separation between the base
 * preset (persistent app theme) and any number of transient scopes (e.g.
 * `chooser-hover`). These tests pin that contract.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import {
    applyColorPreset,
    getBloomThemeCSS,
    restoreBasePreset,
    setBasePreset,
    __resetBloomCSSForTests,
} from "@/lib/bloom-css"

function styleEl(scope: string): HTMLStyleElement | null {
    const el = document.getElementById(`bloom-color-preset-${scope}`)
    return el instanceof HTMLStyleElement ? el : null
}

describe("bloom-css", () => {
    beforeEach(() => {
        __resetBloomCSSForTests()
    })

    test("getBloomThemeCSS returns a :root + .dark block for the preset", () => {
        const css = getBloomThemeCSS("oxy")
        expect(css).toContain(":root {")
        expect(css).toContain(".dark {")
        expect(css).toContain("--primary:")
    })

    test("getBloomThemeCSS emits Bloom RGB token values as rgb() colors", () => {
        const css = getBloomThemeCSS("oxy")
        expect(css).toContain("--primary: rgb(")
        expect(css).not.toContain("--primary: hsl(")
    })

    test("applyColorPreset injects a scoped <style> element", () => {
        applyColorPreset("blue", "chooser-hover")
        const el = styleEl("chooser-hover")
        expect(el).not.toBeNull()
        expect(el?.textContent).toContain(":root {")
        expect(el?.textContent).toContain("--primary:")
    })

    test("applyColorPreset updates the same element on re-apply for the same scope", () => {
        applyColorPreset("blue", "chooser-hover")
        const first = styleEl("chooser-hover")
        applyColorPreset("green", "chooser-hover")
        const second = styleEl("chooser-hover")
        expect(second).toBe(first)
        expect(document.querySelectorAll('style[id="bloom-color-preset-chooser-hover"]').length).toBe(1)
    })

    test("applyColorPreset is a no-op for unknown / null / undefined presets", () => {
        applyColorPreset("not-a-real-preset", "chooser-hover")
        expect(styleEl("chooser-hover")).toBeNull()
        applyColorPreset(null, "chooser-hover")
        expect(styleEl("chooser-hover")).toBeNull()
        applyColorPreset(undefined, "chooser-hover")
        expect(styleEl("chooser-hover")).toBeNull()
    })

    test("setBasePreset captures the preset AND applies it to the base scope", () => {
        setBasePreset("purple")
        const base = styleEl("base")
        expect(base).not.toBeNull()
        expect(base?.textContent).toContain("--primary:")
    })

    test("restoreBasePreset removes a non-base scope and re-applies the captured base", () => {
        setBasePreset("purple")
        applyColorPreset("blue", "chooser-hover")
        expect(styleEl("chooser-hover")).not.toBeNull()

        restoreBasePreset("chooser-hover")
        expect(styleEl("chooser-hover")).toBeNull()
        // Base still present.
        expect(styleEl("base")).not.toBeNull()
    })

    test("restoreBasePreset never removes the base scope itself", () => {
        setBasePreset("purple")
        restoreBasePreset("base")
        // The base scope must remain — its rules are the floor of the cascade.
        expect(styleEl("base")).not.toBeNull()
    })

    test("hover scope is appended AFTER base so its rules win the cascade", () => {
        setBasePreset("oxy")
        applyColorPreset("blue", "chooser-hover")

        const styles = Array.from(document.head.querySelectorAll('style[id^="bloom-color-preset-"]'))
        const baseIdx = styles.findIndex((s) => s.id === "bloom-color-preset-base")
        const hoverIdx = styles.findIndex((s) => s.id === "bloom-color-preset-chooser-hover")
        expect(baseIdx).toBeGreaterThanOrEqual(0)
        expect(hoverIdx).toBeGreaterThan(baseIdx)
    })

    test("when no base preset was registered, restoreBasePreset still tears the scope down", () => {
        applyColorPreset("blue", "chooser-hover")
        expect(styleEl("chooser-hover")).not.toBeNull()
        restoreBasePreset("chooser-hover")
        expect(styleEl("chooser-hover")).toBeNull()
    })
})
