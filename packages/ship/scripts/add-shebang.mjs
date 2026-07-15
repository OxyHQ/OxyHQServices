// Prepend a Node shebang + set the executable bit on the built CLI so the
// `oxy-ship` bin runs directly. tsc does not preserve a source shebang across
// all versions, so we add it deterministically after the build.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(dir, '..', 'dist', 'cli.js');
const shebang = '#!/usr/bin/env node\n';

const contents = readFileSync(cliPath, 'utf8');
if (!contents.startsWith(shebang)) {
  writeFileSync(cliPath, shebang + contents);
}
chmodSync(cliPath, 0o755);
