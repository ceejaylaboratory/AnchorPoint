# =============================================================================
# Certificate Lifecycle Management - Runbook
# =============================================================================
# This runbook documents how TLS certificates are provisioned, renewed, and
# monitored for AnchorPoint, and what to do when the automated renewal alert
# fires. Certificates are issued by Let's Encrypt via cert-manager.
# =============================================================================

## Overview

| Property            | Value                                              |
| ------------------- | -------------------------------------------------- |
| Issuer              | Let's Encrypt (staging + production ClusterIssuer) |
| Manager             | cert-manager (Helm, `infra/k8s/cert-manager`)      |
| Certificate lifetime| 90 days (`duration: 2160h`)                        |
| Auto-renewal window | 30 days before expiry (`renewBefore: 720h`)        |
| Ingress controller  | NGINX Ingress (`infra/k8s/ingress-nginx`)          |
| Challenge type      | ACME HTTP-01 (in-place edit), DNS-01 supported     |
| Production issuer   | `letsencrypt-prod` (ClusterIssuer)                 |
| Ingress annotation  | `cert-manager.io/cluster-issuer: letsencrypt-prod` |

The relevant resources live in `infra/k8s/cert-manager`:

- `cluster-issuer.yaml` / `cluster-issuer-prod.yaml` - Let's Encrypt ClusterIssuers.
- `certificates.yaml` - Certificate resources for each AnchorPoint hostname.
- `ingress-tls-annotations.yaml` - Annotation reference for Ingress TLS.
- `anchorpoint-testnet-ingress.yaml` - Ingress with cert-manager annotations.

## Hostnames covered

| Host                                       | Certificate resource      | TLS secret                |
| ------------------------------------------ | ------------------------- | ------------------------- |
| `api.anchorpoint-testnet.example.com`      | `anchorpoint-api-cert`    | `anchorpoint-api-tls`     |
| `worker.anchorpoint-testnet.example.com`   | `anchorpoint-worker-cert` | `anchorpoint-worker-tls`  |
| `dashboard.anchorpoint-testnet.example.com`| `anchorpoint-dashboard-cert` | `anchorpoint-dashboard-tls` |
| `soroban.anchorpoint-testnet.example.com`  | `anchorpoint-soroban-cert`| `anchorpoint-soroban-tls` |

## How renewal works

cert-manager continuously reconciles each `Certificate` resource. When a
certificate is within `renewBefore` (30 days) of expiry it triggers an ACME
HTTP-01 challenge through the NGINX ingress (`acme.cert-manager.io/http01-edit-in-place: "true"`),
obtains a fresh certificate from Let's Encrypt, and writes it to the matching
Kubernetes TLS secret. The ingress picks up the new secret with no downtime.

The production `ClusterIssuer` (`infra/k8s/cert-manager/cluster-issuer-prod.yaml`)
points at the Let's Encrypt production ACME server with a contact email for
expiry/renewal notifications. Every production Ingress must carry the
annotation `cert-manager.io/cluster-issuer: letsencrypt-prod` so cert-manager
issues and renews the certificate referenced by `spec.tls[].secretName`.

Hosts that cannot satisfy HTTP-01 (e.g. wildcard certificates or hosts not
routed through the ingress) use a DNS-01 `ClusterIssuer` with a DNS provider
solver instead; the renewal flow is otherwise identical.

## Monitoring

Two layers watch for renewal failures:

1. **Prometheus + Alertmanager** (`infra/monitoring`):
   - `AnchorPointCertificateExpiringSoon` (warning) fires when any certificate
     has fewer than **21 days** remaining. Alerts are sent to the
     `#platform-cert-alerts` Slack channel and PagerDuty.
   - `AnchorPointCertificateExpiringCritical` (critical) fires when fewer than
     **15 days** remain, i.e. renewal should already have happened 30 days
     before expiry, so this indicates a failed renewal. Alerts are sent to
     PagerDuty.
   - `AnchorPointCertificateRenewalFailed` (warning) fires when a
     `Certificate` has a `Ready` condition of `False` or a `certmanager_certificate_renewal_timestamp_seconds`
     older than the expected window, catching renewal failures before expiry.
2. **Smoke test** (`scripts/smoke-test.sh`): the `check_certificate_expiry`
   function connects to each hostname over TLS and fails if any certificate has
   fewer than **14 days** remaining. Override the threshold with
   `CERT_MIN_DAYS_REMAINING` and the host list with `CERT_HOSTS`.

## Automated alert notifications

- Slack: set `SLACK_WEBHOOK_URL` on the Alertmanager container and run with
  `--config.expand-env=true`. Cert-manager alerts route to `#platform-cert-alerts`.
- PagerDuty: set `PAGERDUTY_ROUTING_KEY` on the Alertmanager container.

## Responding to a renewal alert

1. Identify the failing certificate from the alert (`{{ $labels.name }}` /
   `{{ $labels.namespace }}`).
2. Inspect the Certificate and its ACME Order:
   ```bash
   kubectl describe certificate <name> -n <namespace>
   kubectl get certificaterequest -n <namespace>
   kubectl get order -n <namespace>
   kubectl get challenge -n <namespace>
   ```
3. Check cert-manager controller logs for ACME/DNS errors:
   ```bash
   kubectl logs -n cert-manager -l app=cert-manager --tail=200
   ```
4. Common causes:
   - DNS for the hostname no longer resolves to the ingress controller (HTTP-01 fails).
   - Rate limiting on Let's Encrypt (especially staging).
   - The ClusterIssuer `Ready` condition is `False`.
5. Troubleshooting failed ACME challenges:
   - **HTTP-01**: confirm the hostname resolves to the ingress controller and
     that `http://<host>/.well-known/acme-challenge/<token>` is reachable
     (no redirect to HTTPS, no auth). Inspect the solver pod and challenge:
     ```bash
     kubectl get challenge -n <namespace> -o wide
     kubectl describe challenge <challenge-name> -n <namespace>
     kubectl get pods -n <namespace> -l acme.cert-manager.io/http01-solver=true
     kubectl logs -n <namespace> -l acme.cert-manager.io/http01-solver=true
     ```
   - **DNS-01**: confirm the `_acme-challenge.<host>` TXT record was created by
     the DNS provider and has propagated:
     ```bash
     kubectl describe challenge <challenge-name> -n <namespace>
     dig +short TXT _acme-challenge.<host>
     ```
     Verify the DNS provider credentials secret referenced by the solver exists
     and is valid.
   - Delete a stuck `Order`/`Challenge` to let cert-manager retry:
     ```bash
     kubectl delete order <order-name> -n <namespace>
     ```
6. Force an immediate renewal by deleting the existing Certificate (cert-manager
   recreates it) or bumping its `spec.secretName`:
   ```bash
   kubectl delete certificate <name> -n <namespace>
   kubectl apply -f infra/k8s/cert-manager/certificates.yaml
   ```
   Or annotate the Certificate to trigger re-issuance:
   ```bash
   kubectl annotate certificate <name> -n <namespace> \
     cert-manager.io/issue-temporary-certificate="true" --overwrite
   ```
7. Validate after renewal:
   ```bash
   echo | openssl s_client -servername <host> -connect <host>:443 2>/dev/null \
     | openssl x509 -noout -enddate
   ```
   Or run the smoke test:
   ```bash
   CERT_HOSTS="<host>" bash scripts/smoke-test.sh
   ```
   Confirm the Certificate is `Ready` and the secret was updated:
   ```bash
   kubectl get certificate <name> -n <namespace> \
     -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
   kubectl get secret <tls-secret> -n <namespace> \
     -o jsonpath='{.metadata.annotations.cert-manager\.io/certificate-name}'
   ```

## Switching staging -> production

The default manifests use `anchorpoint-staging-issuer` to avoid hitting Let's
Encrypt production rate limits while testing. To go live, change every
`Certificate.spec.issuerRef.name` (and the Ingress `cert-manager.io/cluster-issuer`
annotation) to `letsencrypt-prod`, then re-apply.

## Manual QA

1. Apply cert-manager, the ClusterIssuer, Certificates, and the ingress.
2. Confirm certificates reach the `Ready` state:
   ```bash
   kubectl get certificates -n anchorpoint-testnet
   ```
3. Confirm the TLS secrets exist and are populated.
4. Trigger the smoke-test certificate check against the hostnames.
5. Simulate the alert (optional): temporarily lower `renewBefore` or set a
   short `duration` in a test namespace and confirm the Prometheus alert fires
   within the configured `for:` window.
6. Confirm the Ingress carries `cert-manager.io/cluster-issuer: letsencrypt-prod`
   and that the referenced TLS secret is populated by cert-manager.
