/**
 * Tiny zero-dependency argv parser. Supports `--flag value`, `--flag=value`, and
 * boolean `--flag` (no value). The first non-flag token is the command; the rest
 * are collected as positionals. Deliberately minimal — oxy-ship is a CI tool, not
 * an interactive prompt.
 */
export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set(['skip-export', 'dry-run', 'help', 'json']);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
        continue;
      }
      const name = token.slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[name] = true;
      } else {
        flags[name] = next;
        i++;
      }
    } else if (command === undefined) {
      command = token;
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

/** Read a string flag, falling back to an env var, then a default. */
export function stringFlag(
  flags: Record<string, string | boolean>,
  name: string,
  envVar?: string,
  fallback?: string
): string | undefined {
  const value = flags[name];
  if (typeof value === 'string') return value;
  if (envVar && process.env[envVar]) return process.env[envVar];
  return fallback;
}

/** Read a required string flag/env; throw a clear error when missing. */
export function requireString(
  flags: Record<string, string | boolean>,
  name: string,
  envVar: string
): string {
  const value = stringFlag(flags, name, envVar);
  if (!value) {
    throw new Error(`Missing --${name} (or ${envVar})`);
  }
  return value;
}

/** Parse an integer flag within [0, 100], or undefined when absent. */
export function rolloutFlag(flags: Record<string, string | boolean>): number | undefined {
  const value = flags.rollout;
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('--rollout must be an integer between 0 and 100');
  }
  return parsed;
}

/** Resolve the target platforms from `--platform` (default: both). */
export function platformsFlag(flags: Record<string, string | boolean>): Array<'ios' | 'android'> {
  const value = flags.platform;
  if (value === undefined || value === true || value === 'all') {
    return ['ios', 'android'];
  }
  const normalized = String(value).toLowerCase();
  if (normalized !== 'ios' && normalized !== 'android') {
    throw new Error('--platform must be ios, android, or all');
  }
  return [normalized];
}
