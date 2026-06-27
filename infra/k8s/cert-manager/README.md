# =============================================================================
# Cert-Manager Configuration for Let's Encrypt TLS - Issue #419
# =============================================================================
# This directory contains the cert-manager configuration for automatic TLS
# certificate management using Let's Encrypt for the AnchorPoint Kubernetes cluster.
#
# Files:
#   - cert-manager-values.yaml  - Helm values for cert-manager installation
#   - cluster-issuer.yaml       - ClusterIssuer for Let's Encrypt (staging)
#   - cluster-issuer-prod.yaml    - ClusterIssuer for Let's Encrypt (production)
#   - certificates.yaml         - Certificate resources for AnchorPoint hostnames
#   - ingress-tls-annotations.yaml - Annotations for Ingress TLS
#
# Manual QA Steps:
#   1. Install cert-manager:
#      helm repo add jetstack https://charts.jetstack.io
#      helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace -f cert-manager-values.yaml
#
#   2. Verify installation:
#      kubectl get pods -n cert-manager
#
#   3. Apply ClusterIssuer:
#      kubectl apply -f cluster-issuer.yaml
#
#   4. Apply Certificates:
#      kubectl apply -f certificates.yaml
#
#   5. Check certificate status:
#      kubectl get certificates -n anchorpoint-testnet
#
#   6. Verify HTTPS:
#      curl -v https://your-hostname.example.com
# =============================================================================

NGINX ingress controller configuration for this cert-manager setup now lives in:

- `infra/k8s/ingress-nginx/values-testnet.yaml`
- `infra/k8s/ingress-nginx/anchorpoint-testnet-ingress.yaml`

Apply ingress after cert-manager and certificate resources are ready so TLS secrets
can be attached without repeated reconciliation errors:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  -f infra/k8s/ingress-nginx/values-testnet.yaml

kubectl apply -f infra/k8s/ingress-nginx/anchorpoint-testnet-ingress.yaml
kubectl get ingress -n anchorpoint-testnet
```

# =============================================================================
# Implementation Notes:
# =============================================================================
# - Uses staging Let's Encrypt for initial testing
# - Switch to production by applying cluster-issuer-prod.yaml instead
# - Requires NGINX Ingress Controller with HTTP-01 challenge support
# - All resources labeled consistently: app=anchorpoint, environment=testnet
# - Certificates reference the ClusterIssuer via spec.issuerRef
# =============================================================================