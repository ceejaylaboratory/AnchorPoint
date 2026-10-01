#!/usr/bin/env node
// =============================================================================
// install-git-hooks.mjs — point core.hooksPath at .husky
//
// Runs from the root `prepare` script, i.e. on every `npm install`. It is the
// whole of the "husky" integration: the hook files keep the husky v9 layout
// (.husky/<hook>, no wrapper boilerplate, no `_` directory), but the wiring is
// done with git itself instead of a dependency, so nothing has to be added to
// package-lock.json and `npm ci` in CI stays untouched.
//
// Safe to run anywhere, including where there is no git checkout at all: a
// Docker build stage that COPYs the source has no .git directory.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const hooksDir = join(repoRoot, '.husky');

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function main() {
  if (!existsSync(join(repoRoot, '.git'))) {
    // No checkout (npm pack, container build, vendored copy). Nothing to wire.
    return;
  }

  if (!existsSync(hooksDir)) {
    console.warn('install-git-hooks: .husky/ is missing, skipping.');
    return;
  }

  // Never touch a worktree that is not the top level of the repository.
  let topLevel;
  try {
    topLevel = git(['rev-parse', '--show-toplevel'], repoRoot);
  } catch {
    return; // not a git repository
  }
  if (resolve(topLevel) !== repoRoot) {
    return;
  }

  // `git config --get` exits 1 when the key is simply unset, which is the
  // normal state on a fresh clone — that must not be treated as a failure, or
  // every `npm install` (including CI) would abort here.
  let current = '';
  try {
    current = git(['config', '--get', 'core.hooksPath'], repoRoot);
  } catch {
    current = '';
  }

  if (current === '.husky') {
    return; // already installed
  }

  try {
    git(['config', 'core.hooksPath', '.husky'], repoRoot);
  } catch (error) {
    // A contributor on a read-only or otherwise restricted checkout should
    // still be able to install dependencies.
    console.warn(
      `install-git-hooks: could not set core.hooksPath (${error.message}).`,
    );
    console.warn(
      'install-git-hooks: run `git config core.hooksPath .husky` manually to enable the pre-commit secret scan.',
    );
    return;
  }

  if (current) {
    console.warn(
      `install-git-hooks: replaced existing core.hooksPath (${current}) with .husky`,
    );
  }
}

main();
