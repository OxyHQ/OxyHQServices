/**
 * Wrapper for `npx expo export --platform web` that handles an Expo SDK 55 bug
 * where the process hangs after export completes.
 *
 * Root cause: @expo/cli@55.x changed `ensureProcessExitsAfterDelay()` to classify
 * active Timeout handles as "non-blocking" and skip force-exit. But un-unref'd
 * Timeouts from Metro keep the event loop alive indefinitely.
 *
 * @expo/cli@54.x (accounts app) force-exits after 10s — this script replicates
 * that behavior until the bug is fixed upstream.
 *
 * See: https://github.com/expo/expo/issues/27938
 */

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const EXPORT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const child = spawn('npx', ['expo', 'export', '--platform', 'web'], {
  stdio: 'inherit',
  cwd: __dirname.replace(/[\\/]scripts$/, ''),
});

const timeout = setTimeout(() => {
  const distPath = path.join(__dirname, '..', 'dist', 'index.html');
  if (existsSync(distPath)) {
    console.log('\nExport completed but process did not exit (expo/cli#55 bug). Exiting.');
    child.kill('SIGTERM');
    process.exit(0);
  } else {
    console.error('\nExport timed out and dist/index.html was not found.');
    child.kill('SIGTERM');
    process.exit(1);
  }
}, EXPORT_TIMEOUT_MS);

timeout.unref();

child.on('close', (code) => {
  clearTimeout(timeout);
  process.exit(code ?? 0);
});
