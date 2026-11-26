# Security policy

## Supported versions

Security fixes are applied to the default branch (`main`). Release tags, when
published, receive fixes only for the latest minor line.

## Reporting a vulnerability

Please do not open a public GitHub issue for a suspected vulnerability.

1. Open a private report with [GitHub Security Advisories](https://github.com/ceejaylaboratory/AnchorPoint/security/advisories/new).
2. Include the affected component (dashboard, backend, contracts, or infra), steps to reproduce, and impact.
3. Allow maintainers a reasonable window to confirm and patch before any public disclosure. We aim to acknowledge reports within 5 business days.

If you cannot use GitHub advisories, email the maintainers listed on the repository and encrypt the message with the PGP key below.

## PGP keys

Email reports must be encrypted. Use the PGP key published on the repository security advisories page (the same key maintainers use to sign advisory updates):

| Contact | Purpose | Key |
| --- | --- | --- |
| GitHub Security Advisories | Preferred reporting channel | Transport is encrypted by GitHub; no separate key is required |
| Repository maintainers | Fallback email reports | Encrypt to the PGP key linked from the maintainer profile on [ceejaylaboratory/AnchorPoint](https://github.com/ceejaylaboratory/AnchorPoint) before sending |

Confirm the fingerprint against a key already published by a maintainer. Do not trust a fingerprint pasted into an issue comment.

Do not send exploit proof-of-concept material to public channels. Maintainers
will coordinate a fix, credit the reporter unless anonymity is requested, and
publish an advisory after a patch is available.

## Automated vulnerability scanning

CI runs two gates on every pull request:

- **`npm audit --audit-level=high`** in the `audit` jobs of
  `backend.yml` and `dashboard.yml` fails the build when a dependency has a
  High or Critical advisory.
- **Trivy** scans the built container images in `docker.yml` (before push on
  `main`, and against locally built images on pull requests) and fails on any
  HIGH or CRITICAL finding. Findings are uploaded as SARIF to the repository's
  Code Scanning dashboard.

## Vulnerability exception handling

A finding may only be suppressed when no patched version is available and the
exposure is acceptable. Suppressions are time-boxed and must be reviewed.

- **Trivy (container images and filesystem scans):** add the finding ID (for
  example `CVE-2024-12345`) to a `.trivyignore` file. Image scans read
  `.trivyignore` at the repository root; the backend filesystem scan reads
  `backend/.trivyignore`.
- **npm audit:** prefer upgrading via `npm audit fix` or a targeted
  `overrides` entry in `package.json`. If the advisory cannot be remediated,
  document the rationale in the pull request and track an issue to remove the
  exception once a fix ships.

Every exception must include, in the same commit or pull request:

1. The vulnerability ID and affected package/image.
2. Why it cannot be patched yet (e.g. no fixed release, transitive-only
   exposure not reachable at runtime).
3. A follow-up issue link and an intended review/expiry date.

Exceptions without a tracking issue or review date will be rejected in review.
