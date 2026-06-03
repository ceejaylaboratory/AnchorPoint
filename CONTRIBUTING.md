# Contributing to AnchorPoint

Thank you for your interest in contributing to AnchorPoint. This guide is intended for open source developers who want to help improve documentation, fix issues, and add features in a way that aligns with the repository's standards.

## Good First Issue Labels

The `Good First Issue` label is used to identify tasks that are suitable for first-time contributors and contributors who are new to the repository.

### When to use `Good First Issue`
- The issue is limited in scope and clearly defined.
- The task does not require deep domain knowledge of the codebase.
- There is an obvious implementation path or documentation update.
- The issue can be completed without modifying large portions of the repository.

### What contributors should expect
- Clear acceptance criteria in the issue description.
- Minimal risk of breaking adjacent features.
- Review and guidance from maintainers.
- A request to follow the existing coding and documentation style.

### How to find `Good First Issue`
- Search the issue tracker for the `Good First Issue` label.
- Review related repository documentation before starting.
- Ask maintainers for clarification if the task scope is uncertain.

## How to Get Started

1. Fork the repository.
2. Create a branch with a descriptive name, for example:
   - `fix/docs-good-first-issue`
   - `docs/bullmq-worker-setup`
3. Make your changes in the forked repository.
4. Open a pull request against `main`.

## Contribution Standards

### Documentation
- Add documentation in markdown files located in the repository root or `docs/`.
- Keep content factual, short, and consistent with existing documentation style.
- Avoid changing formatting or file structure unless the issue explicitly requires it.

### Code and Tests
- Follow existing patterns in the repository.
- Do not refactor unrelated code.
- Add or update tests only if the issue explicitly requests them.
- When updating backend functionality, make sure errors are handled safely and do not expose secrets.

### Pull Request Guidelines
- Provide a short summary of the changes.
- Reference the related issue number when available.
- Include a brief QA checklist if applicable.
- Verify the change is self-contained and minimal.

## Manual QA Steps

When contributing to AnchorPoint, verify your change with the following steps:

1. Confirm the documentation or code change is present in your branch.
2. If the change affects backend behavior, run relevant tests:
   - `cd backend && npm test`
3. If the change affects frontend behavior, run the frontend locally and verify the affected flows.
4. Check for broken links if you add new documentation files.
5. Review the pull request diff to ensure only the intended files were modified.

## Best Practices for Open Source Developers

- Review `IMPLEMENTATION_SUMMARY.md` and `TASK_QUEUE_SUMMARY.md` when working on backend or task queue related issues.
- Preserve the repository's existing structure and naming conventions.
- Do not add new dependencies unless the issue explicitly requires them.
- Use the issue's acceptance criteria to confirm completion.

## Repository Contact

If you need help, open an issue or request feedback on an existing issue thread. Maintain the repository's security and quality standards by avoiding accidental exposure of environment variables, secrets, or private keys.