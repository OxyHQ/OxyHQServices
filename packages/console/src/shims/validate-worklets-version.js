// Dev-only shim for `react-native-reanimated/scripts/validate-worklets-version`.
// The real file is CommonJS imported from Reanimated's ESM; with Reanimated
// excluded from Vite's dep optimizer (native spec files break pre-bundling),
// dev serves it raw and the default-import fails. The script only sanity-checks
// the reanimated↔react-native-worklets native version pairing ('fabric'
// architecture), which never applies to the web bundle — `vite build` interops
// and runs the real check via Rollup's CJS handling.
export default function validateWorkletsVersion() {
  return { ok: true };
}
