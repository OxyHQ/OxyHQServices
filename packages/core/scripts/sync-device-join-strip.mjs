import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const targetPublicDir = resolve(process.argv[2] ?? '.');
const source = join(dirname(fileURLToPath(import.meta.url)), 'device-join-strip.js');
const dest = join(targetPublicDir, 'public', 'device-join-strip.js');

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(source, dest);
