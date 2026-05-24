#!/usr/bin/env bun
/**
 * generate-openapi.ts — emit a fully-resolved `openapi.json` for the Oxy
 * REST API.
 *
 * Strategy:
 *  1. Start with a hand-maintained `openapi.base.yaml` so server URLs, info
 *     metadata, and security schemes stay stable.
 *  2. Run `swagger-jsdoc` against `src/routes/**\/*.ts` to extract paths from
 *     existing `@openapi` JSDoc blocks (the same machinery the in-process
 *     `/docs` endpoint already uses).
 *  3. Walk the route files and synthesize stub entries for any
 *     `router.<verb>('/path', ...)` calls that don't already have an
 *     `@openapi` block, so consumers see *something* for every endpoint.
 *  4. Write the merged document to `packages/api/openapi.json` so the website
 *     sync step can copy it via `git show <ref>:openapi.json`.
 *
 * The route walker is intentionally regex-based — it doesn't need to be
 * perfect; it just needs to surface coverage gaps. Each missing endpoint
 * gets `{ description: 'TODO' }` so engineers can fill them in.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  servers: Array<{ url: string; description?: string }>;
  components: Record<string, unknown>;
  paths: Record<string, Record<string, unknown>>;
  tags?: Array<{ name: string; description?: string }>;
  [key: string]: unknown;
}

const PACKAGE_ROOT = path.resolve(import.meta.dir, '..');
const BASE_YAML = path.join(PACKAGE_ROOT, 'openapi.base.yaml');
const OUTPUT_JSON = path.join(PACKAGE_ROOT, 'openapi.json');
const ROUTES_DIR = path.join(PACKAGE_ROOT, 'src', 'routes');

/* ------------------------ minimal YAML loader ------------------------ */
/**
 * Tiny YAML parser. The base document is hand-curated and uses only a
 * conservative subset (scalars, lists, nested maps). We avoid a runtime dep.
 */
function parseYaml(input: string): OpenApiDocument {
  const lines = input.split(/\r?\n/);
  let i = 0;

  function parseBlock(indent: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    while (i < lines.length) {
      const rawLine = lines[i];
      if (rawLine === undefined) {
        i += 1;
        continue;
      }
      if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
        i += 1;
        continue;
      }
      const lineIndent = rawLine.length - rawLine.trimStart().length;
      if (lineIndent < indent) return obj;
      const line = rawLine.slice(indent);
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) return obj;
      const key = line.slice(0, colonIdx).trim();
      const rest = line.slice(colonIdx + 1).trim();
      i += 1;
      if (rest === '') {
        // Either nested object or list follows.
        const next = lines[i];
        if (next !== undefined && next.trimStart().startsWith('- ')) {
          // List of scalars / maps.
          const listIndent = next.length - next.trimStart().length;
          const list: unknown[] = [];
          while (i < lines.length) {
            const ln = lines[i];
            if (ln === undefined) {
              i += 1;
              continue;
            }
            if (!ln.trim()) {
              i += 1;
              continue;
            }
            const ind = ln.length - ln.trimStart().length;
            if (ind < listIndent) break;
            if (!ln.trimStart().startsWith('- ')) break;
            const itemRest = ln.trimStart().slice(2);
            i += 1;
            if (itemRest.includes(':')) {
              // Parse a map starting from this line.
              const itemMap: Record<string, unknown> = {};
              const colon = itemRest.indexOf(':');
              const k = itemRest.slice(0, colon).trim();
              const v = itemRest.slice(colon + 1).trim();
              if (v) itemMap[k] = parseScalar(v);
              const nested = parseBlock(listIndent + 2);
              Object.assign(itemMap, nested);
              list.push(itemMap);
            } else {
              list.push(parseScalar(itemRest));
            }
          }
          obj[key] = list;
        } else {
          obj[key] = parseBlock(indent + 2);
        }
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseScalar(raw: string): unknown {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null' || raw === '~') return null;
    if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
    if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  return parseBlock(0) as unknown as OpenApiDocument;
}

/* ----------------------- route walker (stub gen) --------------------- */

interface RouteEntry {
  mountPrefix: string;
  routerVerbPath: string;
  filename: string;
}

const ROUTE_REGEX = /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
// Map: route file basename -> Express mount prefix (from server.ts).
// Kept in sync with `server.ts`. Add new mounts here when extending the API.
const MOUNT_MAP: Record<string, string> = {
  'auth.ts': '/auth',
  'authLinking.ts': '/auth',
  'assets.ts': '/assets',
  'storage.ts': '/storage',
  'search.ts': '/search',
  'profiles.ts': '/profiles',
  'users.ts': '/users',
  'session.ts': '/session',
  'privacy.ts': '/privacy',
  'analytics.routes.ts': '/analytics',
  'payment.routes.ts': '/payments',
  'notifications.routes.ts': '/notifications',
  'karma.routes.ts': '/karma',
  'wallet.routes.ts': '/wallet',
  'linkMetadata.ts': '/link-metadata',
  'locationSearch.ts': '/location-search',
  'developer.ts': '/developer',
  'devices.ts': '/devices',
  'security.ts': '/security',
  'subscription.routes.ts': '/subscription',
  'fedcm.ts': '/fedcm',
  'emailProxy.ts': '/email/proxy',
  'emailInbound.ts': '/email/inbound',
  'email.ts': '/email',
  'alia.ts': '/alia',
  'credits.ts': '/credits',
  'billing.ts': '/billing',
  'models-stats.ts': '/models',
  'platform-stats.ts': '/platform-stats',
  'topics.routes.ts': '/topics',
  'managedAccounts.ts': '/managed-accounts',
  'contacts.ts': '/contacts',
  'socialAuth.ts': '/auth/social',
};

async function listRouteFiles(): Promise<string[]> {
  if (!existsSync(ROUTES_DIR)) return [];
  const entries = await readdir(ROUTES_DIR);
  return entries
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(ROUTES_DIR, f));
}

async function extractRoutes(): Promise<RouteEntry[]> {
  const files = await listRouteFiles();
  const out: RouteEntry[] = [];
  for (const file of files) {
    const basename = path.basename(file);
    const mountPrefix = MOUNT_MAP[basename];
    if (!mountPrefix) continue;
    const source = await readFile(file, 'utf8');
    ROUTE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ROUTE_REGEX.exec(source)) !== null) {
      out.push({
        mountPrefix,
        routerVerbPath: `${match[1]?.toUpperCase()} ${match[2]}`,
        filename: basename,
      });
    }
  }
  return out;
}

function joinPath(mount: string, route: string): string {
  if (route === '/') return mount;
  return `${mount}${route}`.replace(/\/+/g, '/');
}

function expressPathToOpenApi(p: string): string {
  return p.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

function pathParamsFromExpress(p: string): Array<{ name: string }> {
  const names: Array<{ name: string }> = [];
  const re = /:([a-zA-Z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) {
    if (m[1]) names.push({ name: m[1] });
  }
  return names;
}

/* ----------------------------- main ---------------------------------- */

async function main(): Promise<void> {
  if (!existsSync(BASE_YAML)) {
    console.error(`[generate-openapi] missing ${BASE_YAML}`);
    process.exit(1);
  }

  const baseDoc = parseYaml(await readFile(BASE_YAML, 'utf8'));
  if (!baseDoc.paths) baseDoc.paths = {};

  // Pull JSDoc-annotated paths via swagger-jsdoc.
  const jsdocSpec = swaggerJsdoc({
    definition: {
      openapi: baseDoc.openapi ?? '3.0.0',
      info: baseDoc.info,
      servers: baseDoc.servers ?? [],
      components: baseDoc.components ?? {},
    },
    apis: [path.join(ROUTES_DIR, '*.ts')],
  }) as OpenApiDocument;

  const documented = jsdocSpec.paths ?? {};

  // Walk the routers to find any endpoint that the JSDoc scan missed.
  const routes = await extractRoutes();
  const seen = new Set<string>();
  for (const [pathKey, methods] of Object.entries(documented)) {
    for (const method of Object.keys(methods)) {
      seen.add(`${method.toUpperCase()} ${pathKey}`);
    }
  }

  for (const r of routes) {
    const [verb, suffix] = r.routerVerbPath.split(' ');
    if (!verb || !suffix) continue;
    const fullExpressPath = joinPath(r.mountPrefix, suffix);
    const openApiPath = expressPathToOpenApi(fullExpressPath);
    const key = `${verb} ${openApiPath}`;
    if (seen.has(key)) continue;
    const params = pathParamsFromExpress(fullExpressPath);
    if (!documented[openApiPath]) documented[openApiPath] = {};
    documented[openApiPath][verb.toLowerCase()] = {
      summary: `${verb} ${openApiPath}`,
      description: 'TODO — add `@openapi` JSDoc to this route handler.',
      tags: [r.mountPrefix.replace(/^\//, '').split('/')[0] || 'misc'],
      parameters: params.map((p) => ({
        name: p.name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      responses: {
        '200': { description: 'Success' },
        '4XX': { description: 'Client error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '5XX': { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
    seen.add(key);
  }

  const merged: OpenApiDocument = {
    openapi: baseDoc.openapi ?? '3.1.0',
    info: baseDoc.info,
    servers: baseDoc.servers ?? [],
    components: { ...(baseDoc.components ?? {}), ...(jsdocSpec.components ?? {}) },
    paths: documented,
    tags: baseDoc.tags ?? [],
  };

  await writeFile(OUTPUT_JSON, JSON.stringify(merged, null, 2));
  console.error(
    `[generate-openapi] wrote ${OUTPUT_JSON} with ${Object.keys(merged.paths).length} paths, ${routes.length} routes scanned.`,
  );
}

main().catch((err) => {
  console.error('[generate-openapi] fatal:', err);
  process.exit(1);
});
