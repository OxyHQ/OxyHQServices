import { test, expect, describe, afterEach } from 'bun:test';
import { resolveGitCommit, resolveGitBranch } from '../git';

const savedSha = process.env.GITHUB_SHA;
const savedRef = process.env.GITHUB_REF_NAME;

afterEach(() => {
  if (savedSha === undefined) delete process.env.GITHUB_SHA;
  else process.env.GITHUB_SHA = savedSha;
  if (savedRef === undefined) delete process.env.GITHUB_REF_NAME;
  else process.env.GITHUB_REF_NAME = savedRef;
});

describe('git helpers', () => {
  test('an explicit override wins over env and git', () => {
    process.env.GITHUB_SHA = 'env-sha';
    expect(resolveGitCommit('/nonexistent', 'override-sha')).toBe('override-sha');
    process.env.GITHUB_REF_NAME = 'env-ref';
    expect(resolveGitBranch('/nonexistent', 'override-branch')).toBe('override-branch');
  });

  test('GITHUB_SHA / GITHUB_REF_NAME are used when no override is given', () => {
    process.env.GITHUB_SHA = 'ci-sha';
    process.env.GITHUB_REF_NAME = 'ci-branch';
    expect(resolveGitCommit('/nonexistent')).toBe('ci-sha');
    expect(resolveGitBranch('/nonexistent')).toBe('ci-branch');
  });

  test('outside a git checkout (and no env) it resolves to undefined', () => {
    delete process.env.GITHUB_SHA;
    delete process.env.GITHUB_REF_NAME;
    expect(resolveGitCommit('/nonexistent')).toBeUndefined();
    expect(resolveGitBranch('/nonexistent')).toBeUndefined();
  });
});
