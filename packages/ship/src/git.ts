import { spawnSync } from 'node:child_process';

/** Run a git command in `cwd`, returning trimmed stdout or undefined on any failure. */
function git(cwd: string, args: string[]): string | undefined {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const out = result.stdout.trim();
  return out.length > 0 ? out : undefined;
}

/**
 * Resolve the commit SHA for the published bundle: `--git-commit`/`GITHUB_SHA`
 * override, else `git rev-parse HEAD`. Undefined outside a git checkout.
 */
export function resolveGitCommit(cwd: string, override?: string): string | undefined {
  if (override) return override;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return git(cwd, ['rev-parse', 'HEAD']);
}

/**
 * Resolve the branch: `--git-branch`/`GITHUB_REF_NAME` override, else
 * `git rev-parse --abbrev-ref HEAD` (`HEAD` in a detached checkout → undefined).
 */
export function resolveGitBranch(cwd: string, override?: string): string | undefined {
  if (override) return override;
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch && branch !== 'HEAD' ? branch : undefined;
}
