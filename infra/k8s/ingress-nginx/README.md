# NGINX Ingress Controller Setup (Testnet)

This directory contains the NGINX ingress-controller configuration and ingress
resource required for AnchorPoint testnet routing.

## Files

- `values-testnet.yaml`: Helm values for installing `ingress-nginx`
- `anchorpoint-testnet-ingress.yaml`: Ingress routing for `api.anchorpoint-testnet.example.com`

## Manual QA Steps

1. Install or upgrade ingress-nginx with testnet values:
   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm repo update
   helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
     --namespace ingress-nginx --create-namespace \
     -f infra/k8s/ingress-nginx/values-testnet.yaml
   ```

2. Verify controller pods and external service:
   ```bash
   kubectl get pods -n ingress-nginx
   kubectl get svc -n ingress-nginx
   ```

3. Apply AnchorPoint ingress resource:
   ```bash
   kubectl apply -f infra/k8s/ingress-nginx/anchorpoint-testnet-ingress.yaml
   ```

4. Verify ingress status and routing:
   ```bash
   kubectl get ingress -n anchorpoint-testnet
   kubectl describe ingress anchorpoint-api-ingress -n anchorpoint-testnet
   ```

5. Validate TLS and endpoint:
   ```bash
   kubectl get secret anchorpoint-api-tls -n anchorpoint-testnet
   curl -v https://api.anchorpoint-testnet.example.com/health
   ```

6. Roll back if needed:
   ```bash
   kubectl delete -f infra/k8s/ingress-nginx/anchorpoint-testnet-ingress.yaml
   helm uninstall ingress-nginx -n ingress-nginx
   ```
