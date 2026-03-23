/**
 * Wrapper for `npx expo export --platform web` that handles an Expo SDK 55 bug
 * where the process hangs after export completes.
 *
 * Root cause: @expo/cli@55.x changed `ensureProcessExitsAfterDelay()` to classify
 * active Timeout handles as "non-blocking" and skip force-exit. But un-unref'd
 * Timeouts from Metro keep the event loop alive indefinitely.
 *
 * Strategy: spawn the export in a detached process group, watch stdout for
 * "Exported:" (which means the static files are written), then SIGKILL the
 * entire process group and exit 0. This kills all Metro/Node children instantly
 * instead of waiting for a 5-minute timeout.
 *
 * See: https://github.com/expo/expo/issues/27938
 */

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const EXPORT_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes hard limit (DO build instances are slow)
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist', 'index.html');

const child = spawn('bun', ['x', 'expo', 'export', '--platform', 'web'], {
  cwd: projectRoot,
  stdio: ['inherit', 'pipe', 'pipe'],
  detached: true, // new process group so we can kill the whole tree
});

let done = false;

function finish(code) {
  if (done) return;
  done = true;
  try {
    process.kill(-child.pid, 'SIGKILL'); // kill entire process group
  } catch (_) {}
  process.exit(code);
}

child.stdout.on('data', (data) => {
  process.stdout.write(data);
  if (data.toString().includes('Exported:')) {
    console.log('\nExport completed. Killing hung process group.');
    finish(0);
  }
});

child.stderr.on('data', (data) => {
  process.stderr.write(data);
});

child.on('exit', (code) => {
  if (!done) {
    // Process exited on its own (no hang) — check if it succeeded
    if (code === 0 || existsSync(distPath)) {
      finish(0);
    } else {
      console.error(`\nExport failed with exit code ${code}`);
      finish(1);
    }
  }
});

child.on('error', (err) => {
  console.error('\nFailed to start export:', err.message);
  finish(1);
});

setTimeout(() => {
  if (!done) {
    if (existsSync(distPath)) {
      console.log('\nExport timed out but dist exists. Exiting successfully.');
      finish(0);
    } else {
      console.error('\nExport timed out after 4 minutes with no output.');
      finish(1);
    }
  }
}, EXPORT_TIMEOUT_MS);
