# Contributing to AnchorPoint

Thank you for your interest in contributing to AnchorPoint! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js** >= 18.x
- **npm** >= 9.x
- **Rust** and **Cargo** (for smart contracts)
- **Docker** and **Docker Compose** (optional, for full stack)

### Getting Started

1. **Clone the repository:**

   ```bash
   git clone https://github.com/ceejaylaboratory/AnchorPoint.git
   cd AnchorPoint
   ```

2. **Install dependencies:**

   ```bash
   # Backend
   cd backend && npm install

   # Dashboard (frontend)
   cd ../dashboard && npm install
   ```

3. **Set up environment variables:**

   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Run database migrations:**

   ```bash
   cd backend
   npx prisma migrate dev
   ```

5. **Start the development servers:**

   ```bash
   # Backend (from /backend)
   npm run dev

   # Dashboard (from /dashboard)
   npm run dev
   ```

### Using Docker (Full Stack)

```bash
docker-compose up -d
```

This starts the backend, Redis, Jaeger (tracing), and Prometheus (metrics).

## Project Structure

```
AnchorPoint/
├── backend/          # Node.js/TypeScript API server
│   ├── src/          # Source code
│   ├── prisma/       # Database schema and migrations
│   ├── docs/         # Backend documentation
│   └── scripts/      # Utility scripts
├── dashboard/        # React/Vite frontend
│   └── src/          # Source code (components, pages, hooks)
├── contracts/        # Stellar smart contracts (Rust/Soroban)
│   ├── anchorpoint/  # Core anchor contract
│   ├── staking/      # Staking contract
│   ├── swap/         # Token swap contract
│   └── ...           # Other contracts
├── demo/             # Mock anchor server for local testing
├── infra/            # Infrastructure configuration
├── scripts/          # Project-level scripts
└── tools/            # Development tools
```

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/ceejaylaboratory/AnchorPoint/issues) to avoid duplicates.
2. Open a new issue with the **bug** label.
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, etc.)

### Suggesting Features

1. Open an issue with the **enhancement** label.
2. Describe the use case and proposed solution.
3. Wait for discussion before implementing.

### Submitting Changes

1. **Fork** the repository.
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following the code style guidelines below.
4. **Write or update tests** for your changes.
5. **Commit** with a clear message:
   ```bash
   git commit -m "feat: add virtual scrolling to transaction list"
   ```
6. **Push** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Open a Pull Request** against `main`.

### Secret Scanning (pre-commit)

A leaked key cannot be un-leaked. Even if you delete the file and force-push,
the blob stays in the reflog, in every clone, and on GitHub's servers until the
credential is rotated. The repository therefore installs a
[secretlint](https://github.com/secretlint/secretlint) pre-commit hook that scans
staged content and aborts the commit when it finds a credential.

**Nothing to install by hand.** The root `npm install` runs
`scripts/install-git-hooks.mjs`, which points `core.hooksPath` at `.husky`. The
hook uses the husky v9 layout, so if you later add husky itself the existing
hook file is picked up unchanged.

Verify it is active:

```bash
git config --get core.hooksPath   # -> .husky
```

**What it checks**

- every staged file, via secretlint's recommended rule set (private keys, AWS,
  GCP, GitHub, Slack, Stripe, npm, and generic high-entropy credentials)
- a separate hard refusal for any staged `.env` file — only `*.env.example`
  belongs in git, and `.env` is already gitignored, so this only fires on
  `git add -f`
- a PEM private-key header check that still runs when secretlint itself cannot
  start (offline machine, cold npx cache)

**Scan the whole repository at any time**

```bash
npm run lint:secrets
```

**Bypassing the hook**

```bash
SKIP_SECRETLINT=1 git commit -m "..."
```

Only for a false positive you have already confirmed, and say so in the commit
message. The hook fails closed: if secretlint cannot run, the commit is
aborted, because a contributor with no network must not be able to opt out of
the check by accident.

**If the hook blocks you with a real finding**

1. Do not commit it. Unstage the file: `git reset -- <file>`.
2. If the value is a live credential, rotate it first — removing the line is
   not enough.
3. Move the value into a real secret store or an untracked `.env`, and commit a
   placeholder to `*.env.example` instead.
4. If the finding is a placeholder that looks like a real key, add the path to
   `.secretlintignore` with a comment explaining why it is safe.

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Optional longer description.
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation changes
- `style` — Formatting, no code change
- `refactor` — Code restructuring
- `test` — Adding or updating tests
- `chore` — Build process, dependencies

**Examples:**
```
feat(dashboard): add dark mode toggle
fix(backend): handle expired JWT tokens gracefully
docs: update README with setup instructions
```

## Code Style

### Backend (TypeScript)

- Use **TypeScript** strict mode.
- Run linter before committing:
  ```bash
  cd backend && npm run lint
  ```
- Run tests:
  ```bash
  cd backend && npm test
  ```

### Dashboard (React/TypeScript)

- Use **functional components** with hooks.
- Use **Tailwind CSS** for styling.
- Follow the existing component structure in `src/components/`.

### Contracts (Rust/Soroban)

- Run tests:
  ```bash
  cd contracts
  cargo test
  ```
- Ensure no compiler warnings:
  ```bash
  cargo clippy
  ```

## Testing

### Backend Tests

```bash
cd backend
npm test                 # Run all tests
npm test -- --watch      # Watch mode
```

### Contract Tests

```bash
cd contracts
cargo test               # Run all contract tests
```

### Manual Testing

1. Start the demo server:
   ```bash
   cd demo && npm start
   ```
2. Start the dashboard:
   ```bash
   cd dashboard && npm run dev
   ```
3. Open http://localhost:5173 in your browser.

### Mutation Testing

Mutation testing (via [`cargo-mutants`](https://mutants.rs/)) measures how well the
contract test suites detect injected bugs ("mutants"). Every mutant that is not
caught by a failing test is a gap in the test coverage. The CI pipeline runs the
mutation suite for the core token, staking, and liquid staking contracts; a PR
must not leave any *missed* mutants.

**Install the tool:**

```bash
cargo install cargo-mutants --locked
```

**Run locally** — the repository has two Cargo workspaces, each with its own
`mutants.toml` config (cargo-mutants only auto-discovers `.cargo/mutants.toml`,
so the config is passed explicitly with `--config`):

```bash
# Root workspace: SEP-41 token + staking contracts
cargo mutants --config mutants.toml -p sep41-token -p staking -j 2

# Contracts workspace: liquid staking (--in-place is required because the
# contracts workspace references a crate outside of it via a path dependency)
cd contracts && cargo mutants --config mutants.toml -p liquid_staking --in-place
```

A successful run ends with `0 missed` and exit code 0.

**Guidelines for improving the mutation score:**

- When a mutant is *missed*, add a focused edge-case test that exercises the
  mutated behavior, e.g. zero amounts, negative inputs, boundary timestamps,
  or the absence of an emitted event. See the `get_past_balance` balance-history
tests in `src/token/lib.rs` or the string-helper tests in
`contracts/liquid_staking/src/lib.rs` for examples.
- Some mutants are *behaviorally equivalent* to the original code (e.g. a guard
  changed from `> 0` to `>= 0` where a zero-value token transfer is a no-op).
  These cannot be killed by any test; document them in the `exclude_re` list of
the relevant `mutants.toml` with an explanation, and keep the file's comment
up to date so the exclusion stays justified.
- `unviable` mutants (that fail to compile) are expected and do not fail the run.

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR.
- Include a clear description of what changed and why.
- Reference related issues (e.g., `Closes #42`).
- Ensure CI passes before requesting review.
- Be responsive to review feedback.

## Code of Conduct

Please be respectful and constructive in all interactions. We are building a welcoming community for developers of all backgrounds.

## Questions?

If you have questions, feel free to:
- Open a [discussion](https://github.com/ceejaylaboratory/AnchorPoint/issues) on GitHub
- Check existing documentation in the `docs/` directories

Thank you for contributing to AnchorPoint!
