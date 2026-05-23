/**
 * Bundler-Opaque Dynamic Import
 *
 * Helper for performing runtime dynamic `import()` of platform-specific modules
 * (e.g. Node's built-in `crypto`, `expo-crypto`, `expo-secure-store`,
 * `@react-native-async-storage/async-storage`) in a way that is invisible to
 * every bundler's static analyzer.
 *
 * # Why this exists
 *
 * `@oxyhq/core` is platform-agnostic and ships a single dual CJS/ESM build
 * consumed by Node servers, browser bundles (Vite, webpack, Rollup, esbuild),
 * and React Native (Metro/Hermes). Several code paths must dynamically load
 * a Node-only module (e.g. `crypto`) when running on Node, but the *file*
 * containing the dynamic import is bundled by Metro for RN builds where the
 * dynamic import will never actually execute.
 *
 * Naive patterns all fail in at least one bundler:
 *
 *   - `await import('crypto')`                    — Metro errors at bundle time
 *   - `const n = 'crypto'; await import(n)`       — Metro follows the variable
 *   - `await import(/* @vite-ignore *\/ n)`       — Vite-only directive; ignored by Metro
 *   - `eval('import("crypto")')`                  — direct eval; CSP/perf issues
 *
 * The Function-constructor pattern below is opaque to every AST-level static
 * analyzer (Metro, Vite, webpack, esbuild, Rollup, Parcel) because the import
 * specifier is a runtime string evaluated inside a `new Function(...)` body.
 * Bundlers cannot see through the Function constructor — it is, by spec, an
 * indirect eval whose body string is opaque at compile time.
 *
 * The constructed function is cached at module load so we pay the
 * `new Function` cost exactly once.
 *
 * # Runtime requirements
 *
 * - The host must permit `Function` constructor (most CSPs allow this; strict
 *   CSPs that block `unsafe-eval` will reject — in that case, consumers should
 *   not be loading the offending platform-specific code path anyway).
 * - The host must support dynamic `import()` (Node 12.20+, all modern browsers,
 *   Hermes 0.12+ / RN 0.71+).
 *
 * # Usage
 *
 * ```ts
 * import { bundlerOpaqueImport } from '../utils/dynamicImport';
 *
 * if (isNodeJS()) {
 *   const nodeCrypto = await bundlerOpaqueImport<typeof import('crypto')>('crypto');
 *   return nodeCrypto.randomBytes(32);
 * }
 * ```
 *
 * The type parameter preserves typings while keeping the call site bundler-safe.
 */

// Build the indirect importer exactly once.
//
// The Function body is a single expression (`import(m)`) that the engine
// compiles at constructor time. From a bundler's perspective this is just a
// `new Function(...)` call with string arguments — the embedded `import(...)`
// is not in any of the syntactic positions a bundler scans, so it is never
// rewritten or pre-resolved.
const indirectImport: (specifier: string) => Promise<unknown> = new Function(
  'specifier',
  'return import(specifier);'
) as (specifier: string) => Promise<unknown>;

/**
 * Dynamically import a module by specifier in a way that is invisible to
 * every bundler's static analyzer.
 *
 * Use this for platform-specific modules that must not be bundled on
 * platforms where they will never execute (e.g. Node's `crypto` in an RN
 * build, `expo-crypto` in a Node build).
 *
 * Callers should gate the call with the appropriate platform check
 * (`isNodeJS()`, `isReactNative()`, etc.) so the dynamic import only fires
 * on a host where the module actually exists.
 *
 * @param specifier The module specifier to import (e.g. `'crypto'`).
 * @returns A promise resolving to the loaded module namespace.
 * @throws If the host does not support dynamic `import()` or the module
 *   cannot be resolved.
 */
export async function bundlerOpaqueImport<T = unknown>(specifier: string): Promise<T> {
  return indirectImport(specifier) as Promise<T>;
}
