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
