/**
 * Every module this package NAMES must be declared, and every module reachable
 * from the root barrel must be declared in a way that actually installs it.
 *
 * Two failures of that rule have shipped:
 *
 *   1. `expo-notifications` was an OPTIONAL peer named from a barrel-reachable
 *      module. `tsc` resolves the specifier of an `import()` even when the call
 *      is lazy and wrapped in try/catch, and a package manager does NOT install
 *      an optional peer — so every consumer that had no interest in push failed
 *      to type-check with TS2307. Fixed in 23.0.0 by moving that adapter behind
 *      `@oxyhq/services/notifications` (see `notifications/barrelIsolation.test.ts`).
 *
 *   2. `expo-image-picker`, `expo-image-manipulator`, `expo-haptics` and
 *      `expo-document-picker` had the same shape, and `expo-web-browser` was
 *      not declared at ALL. Unlike the push adapter these back core SDK
 *      surfaces — ChangeAvatar, AvatarCrop, FileManagement and the native
 *      "Sign in with Oxy" lane — so they were reclassified as REQUIRED peers
 *      rather than hidden behind subpaths. This file is what keeps them there.
 *
 * The check walks the REAL module graph rather than grepping `src/index.ts`,
 * because the failure mode is transitive: a module three re-exports down is
 * just as much in a consumer's program as one the barrel names directly.
 *
 * TWO graphs are walked, because tsc and Metro disagree about what a consumer
 * loads:
 *
 *   - the `tsc` graph follows `import` / `export … from` / `import()` only. A
 *     specifier here forces TS2307 on every consumer that has not installed it.
 *   - the Metro graph additionally follows `require()`, which `routes.ts` uses
 *     for its lazy screen table. A specifier reachable only this way does not
 *     break `tsc` today — but it backs a screen the SDK's own router can open,
 *     so an absent module is a broken core surface at runtime, and any future
 *     static import of that screen would promote it into the `tsc` graph too.
 *     `expo-document-picker` sits in exactly that position.
 *
 * The third assertion is the one that keeps THIS FILE honest: `packages/services`
 * used to type-check against four of these modules only because sibling
 * workspace packages hoisted them into the root `node_modules`. A gate that
 * passes because of a neighbour is not a gate, so every module named anywhere
 * in `src/` must be in this package's own `dependencies` or `devDependencies`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '../..');
const SRC = join(PACKAGE_ROOT, 'src');
const BARREL = join(SRC, 'index.ts');

interface Manifest {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const manifest = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
) as Manifest;

const dependencies = manifest.dependencies ?? {};
const devDependencies = manifest.devDependencies ?? {};
const peerDependencies = manifest.peerDependencies ?? {};
const peerMeta = manifest.peerDependenciesMeta ?? {};

/**
 * Vacuity floors. Without them a traversal that silently resolved nothing (a
 * changed extension convention, a bad join, a renamed barrel) would report "no
 * offenders" and pass while checking nothing at all.
 */
const MIN_TSC_REACHABLE = 100;
const MIN_METRO_REACHABLE = 150;
const MIN_SCANNED_FILES = 180;
const MIN_EXTERNAL_MODULES = 20;

const EXTENSIONS = ['.ts', '.tsx', '.native.ts', '.native.tsx', '.web.ts', '.web.tsx'];

/** Resolve a relative specifier to a concrete file on disk, or `null`. */
function resolveRelative(fromFile: string, specifier: string): string | null {
    const base = resolve(dirname(fromFile), specifier);
    for (const extension of EXTENSIONS) {
        const candidate = `${base}${extension}`;
        if (existsFile(candidate)) return candidate;
    }
    for (const extension of EXTENSIONS) {
        const candidate = join(base, `index${extension}`);
        if (existsFile(candidate)) return candidate;
    }
    return null;
}

function existsFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

const STATIC_AND_DYNAMIC_IMPORT = [
    /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
];

/** The `require()` form, which Metro follows and `tsc` does not. */
const REQUIRE_CALL = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(source: string, includeRequire: boolean): string[] {
    const found: string[] = [];
    const patterns = includeRequire
        ? [...STATIC_AND_DYNAMIC_IMPORT, REQUIRE_CALL]
        : STATIC_AND_DYNAMIC_IMPORT;
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            found.push(match[1]);
        }
    }
    return found;
}

/** `expo-image/build/Image` and `@oxyhq/bloom/theme` both belong to one package. */
function packageNameOf(specifier: string): string {
    return specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] as string);
}

interface Reachable {
    /** Every file reachable from the barrel. */
    files: Set<string>;
    /** For each reached file, the file that first pulled it in. */
    parents: Map<string, string>;
}

function walkFromBarrel(includeRequire: boolean): Reachable {
    const files = new Set<string>([BARREL]);
    const parents = new Map<string, string>();
    const queue = [BARREL];

    while (queue.length > 0) {
        const current = queue.shift() as string;
        for (const specifier of specifiersOf(readFileSync(current, 'utf8'), includeRequire)) {
            if (!specifier.startsWith('.')) continue;
            const next = resolveRelative(current, specifier);
            if (next === null || files.has(next)) continue;
            files.add(next);
            parents.set(next, current);
            queue.push(next);
        }
    }
    return { files, parents };
}

/** The chain from the barrel down to `file`, for a failure message that names names. */
function chainTo(file: string, parents: Map<string, string>): string {
    const chain: string[] = [];
    let cursor: string | undefined = file;
    while (cursor !== undefined) {
        chain.unshift(relative(SRC, cursor));
        cursor = parents.get(cursor);
    }
    return chain.join('\n      -> ');
}

function everySourceFile(): string[] {
    const found: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory)) {
            const path = join(directory, entry);
            if (statSync(path).isDirectory()) {
                visit(path);
            } else if (/\.tsx?$/.test(path) && !path.endsWith('.d.ts')) {
                found.push(path);
            }
        }
    };
    visit(SRC);
    return found;
}

/** How a module is declared, in the words the failure message should use. */
function declarationOf(name: string): string {
    if (name in dependencies) return 'dependency';
    if (name in peerDependencies) {
        return peerMeta[name]?.optional === true ? 'OPTIONAL peer' : 'required peer';
    }
    return 'UNDECLARED';
}

/** A module a consumer is guaranteed to have: installed by depending on us. */
function isGuaranteedForConsumers(name: string): boolean {
    return name in dependencies || (name in peerDependencies && peerMeta[name]?.optional !== true);
}

const tscGraph = walkFromBarrel(false);
const metroGraph = walkFromBarrel(true);
const sourceFiles = everySourceFile();

/** Every external package named by any file in `src/`, mapped to its namers. */
const externalModules = new Map<string, string[]>();
for (const file of sourceFiles) {
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'), true)) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        const name = packageNameOf(specifier);
        const namers = externalModules.get(name) ?? [];
        if (!namers.includes(file)) namers.push(file);
        externalModules.set(name, namers);
    }
}

/** External modules named by a file reachable from the barrel in `graph`. */
function offendersIn(graph: Reachable): string {
    const detail: string[] = [];
    for (const [name, namers] of [...externalModules].sort()) {
        if (isGuaranteedForConsumers(name)) continue;
        for (const file of namers) {
            if (!graph.files.has(file)) continue;
            detail.push(
                `\n  ${name} [${declarationOf(name)}] is named by:\n      ${chainTo(file, graph.parents)}`,
            );
        }
    }
    return detail.join('');
}

describe('every module the barrel can reach is a module consumers are given', () => {
    it(`the tsc traversal reaches at least ${MIN_TSC_REACHABLE} files (not vacuous)`, () => {
        expect(tscGraph.files.size).toBeGreaterThanOrEqual(MIN_TSC_REACHABLE);
    });

    it(`the Metro traversal reaches at least ${MIN_METRO_REACHABLE} files (not vacuous)`, () => {
        expect(metroGraph.files.size).toBeGreaterThanOrEqual(MIN_METRO_REACHABLE);
        // `require()` in `routes.ts` is the whole reason the two graphs differ.
        expect(metroGraph.files.size).toBeGreaterThan(tscGraph.files.size);
    });

    it(`scans at least ${MIN_SCANNED_FILES} source files naming ${MIN_EXTERNAL_MODULES}+ external modules (not vacuous)`, () => {
        expect(sourceFiles.length).toBeGreaterThanOrEqual(MIN_SCANNED_FILES);
        expect(externalModules.size).toBeGreaterThanOrEqual(MIN_EXTERNAL_MODULES);
    });

    it('the traversals resolve known files (not vacuous)', () => {
        expect(tscGraph.files).toContain(join(SRC, 'ui/context/OxyContext.tsx'));
        // Reached only through `require()` in the lazy screen table.
        expect(metroGraph.files).toContain(join(SRC, 'ui/screens/FileManagementScreen.tsx'));
        expect(tscGraph.files).not.toContain(join(SRC, 'ui/screens/FileManagementScreen.tsx'));
    });

    it('names no module a consumer might not have installed (tsc graph — TS2307)', () => {
        expect(offendersIn(tscGraph)).toBe('');
    });

    it('names no module a consumer might not have installed (Metro graph — broken surface)', () => {
        expect(offendersIn(metroGraph)).toBe('');
    });
});

describe("this package's own type-check does not lean on sibling workspace packages", () => {
    it('declares every module it names in its own dependencies or devDependencies', () => {
        const missing = [...externalModules]
            .filter(([name]) => !(name in dependencies) && !(name in devDependencies))
            .sort()
            .map(
                ([name, namers]) =>
                    `\n  ${name} [${declarationOf(name)}] — named by ${namers
                        .slice(0, 3)
                        .map((file) => relative(SRC, file))
                        .join(', ')}`,
            )
            .join('');
        expect(missing).toBe('');
    });
});
