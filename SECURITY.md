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
