#!/usr/bin/env bun
/**
 * Write a Cloudflare Pages `_headers` file for an Oxy HTML app.
 *
 * Reads optional `oxy.pages-headers.json` from the caller package (cwd) for
 * per-app CSP extensions, then writes `_headers` into the target directory
 * (default: `public/`).
 *
 * Usage (from an app package):
 *   bun ../core/scripts/writePagesHeaders.ts public
 *   bun ../core/scripts/writePagesHeaders.ts dist
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildOxyPagesHeaders,
  type OxyCspExtensions,
  type OxyPagesHeadersOptions,
} from '../src/server/securityHeaders.ts';

interface PagesHeadersConfig {
  csp?: OxyCspExtensions;
  hsts?: boolean;
}

function loadConfig(): OxyPagesHeadersOptions {
  const configPath = resolve(process.cwd(), 'oxy.pages-headers.json');
  if (!existsSync(configPath)) return {};
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as PagesHeadersConfig;
  return { csp: raw.csp, hsts: raw.hsts };
}

const outputDir = resolve(process.cwd(), process.argv[2] ?? 'public');
const outputPath = resolve(outputDir, '_headers');
const body = buildOxyPagesHeaders(loadConfig());

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, body, 'utf8');
process.stdout.write(`Wrote ${outputPath}\n`);
