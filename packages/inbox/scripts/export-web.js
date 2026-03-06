/**
 * Wrapper for `npx expo export --platform web` that handles an Expo SDK 55 bug
 * where the process hangs after export completes.
 *
 * Root cause: @expo/cli@55.x changed `ensureProcessExitsAfterDelay()` to classify
 * active Timeout handles as "non-blocking" and skip force-exit. But un-unref'd
 * Timeouts from Metro keep the event loop alive indefinitely.
 *
 * Uses execSync with a timeout so the entire child process tree is killed when
 * the timeout fires — preventing orphan processes that block the buildpack.
 *
 * See: https://github.com/expo/expo/issues/27938
 */

const { execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const EXPORT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist', 'index.html');

try {
  execSync('npx expo export --platform web', {
    stdio: 'inherit',
    cwd: projectRoot,
    timeout: EXPORT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
} catch (err) {
  // execSync throws on timeout (ETIMEDOUT) or non-zero exit
  if (existsSync(distPath)) {
    console.log('\nExport completed but process did not exit (expo/cli#55 bug). Exiting.');
    process.exit(0);
  }
  console.error('\nExport failed:', err.message);
  process.exit(1);
}
