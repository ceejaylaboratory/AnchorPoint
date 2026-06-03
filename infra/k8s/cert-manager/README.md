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

# =============================================================================
# Implementation Notes:
# =============================================================================
# - Uses staging Let's Encrypt for initial testing
# - Switch to production by applying cluster-issuer-prod.yaml instead
# - Requires NGINX Ingress Controller with HTTP-01 challenge support
# - All resources labeled consistently: app=anchorpoint, environment=testnet
# - Certificates reference the ClusterIssuer via spec.issuerRef
# =============================================================================