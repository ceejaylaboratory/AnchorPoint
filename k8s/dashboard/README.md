# AnchorPoint Dashboard Kubernetes Manifests

This directory houses the Kubernetes infrastructure-as-code manifests for the AnchorPoint Dashboard (Frontend UI).

## Service Approach
**Option A — ClusterIP + Ingress**
We use a ClusterIP Service exposed externally via an NGINX Ingress controller. This is standard for web services because it enables centralized TLS termination (via cert-manager), allows for powerful host/path-based routing, and reduces cloud spend by multiplexing traffic through a single cloud LoadBalancer.

## Manifest Overview
- `configmap.yaml`: Non-sensitive configuration (e.g. `NEXT_PUBLIC_NETWORK`, API and Horizon URLs).
- `deployment.yaml`: Manages the web server Pods, zero-downtime rolling update strategy, hardened security contexts, and resource bounds. 
- `service.yaml`: ClusterIP providing a stable internal network endpoint for the pods.
- `ingress.yaml`: Defines external web routing rules and connects to cert-manager to automatically mint TLS certificates.
- `hpa.yaml`: HorizontalPodAutoscaler to horizontally scale pods up/down based on CPU utilization.
- `network-policy.yaml`: Zero-trust network rules limiting inbound traffic strictly to the ingress controller and outbound traffic strictly to DNS and the API.
- `kustomization.yaml`: Kustomize base configuration allowing declarative bulk deployment and cross-environment overlays.

## Prerequisites
1. **Ingress Controller:** NGINX ingress controller must be running in the `ingress-nginx` namespace.
2. **Cert-Manager:** cert-manager must be running and have a `ClusterIssuer` named `letsencrypt-prod` available.
3. **Namespace:** The target namespace must exist: `kubectl create namespace anchorpoint-testnet`.
4. **Secrets:** A Kubernetes Secret named `dashboard-secrets` must exist in `anchorpoint-testnet` containing any required sensitive variables (like authentication salts or keys).

## Deployment Instructions

To deploy or update the dashboard to testnet, run:

```bash
kubectl apply -k k8s/dashboard/
```

## Verification & QA

1. **Verify the Rollout:** Ensure the new pods deploy without crashing.
   ```bash
   kubectl rollout status deployment/dashboard -n anchorpoint-testnet
   ```
2. **Verify Resource States:** Check the Service, Pods, and Ingress to ensure they bound cleanly.
   ```bash
   kubectl get pods,svc,ingress -n anchorpoint-testnet -l component=dashboard
   ```
3. **Manual QA Steps:**
   - Open a browser and navigate to `https://dashboard.testnet.anchorpoint.xyz`.
   - Confirm the TLS certificate is issued by Let's Encrypt and valid.
   - Run a test transaction or UI action to ensure API and Horizon connections succeed.
   - Confirm the `/api/health` probe returns a `200 OK` via `curl -I https://dashboard.testnet.anchorpoint.xyz/api/health`.

## Promoting to Production

This directory acts as a Kustomize base. To deploy to production, do not edit these files directly. Instead:
1. Create a production overlay directory: `k8s/dashboard/overlays/production/`.
2. Create a `kustomization.yaml` inside it referencing the base:
   ```yaml
   apiVersion: kustomize.config.k8s.io/v1beta1
   kind: Kustomization
   resources:
     - ../../base
   namespace: anchorpoint-production
   ```
3. Apply `patches` in your production `kustomization.yaml` to:
   - Update `dashboard.testnet.anchorpoint.xyz` to `dashboard.anchorpoint.xyz` (Ingress).
   - Adjust `minReplicas` and `maxReplicas` to production levels (HPA).
   - Update ConfigMap URLs to hit production endpoints.

## Troubleshooting

- **Pod not ready or crashlooping:** Check for failed liveness/readiness probes or missing secrets.
  ```bash
  kubectl describe pod -l component=dashboard -n anchorpoint-testnet
  kubectl logs -l component=dashboard -n anchorpoint-testnet
  ```
- **Ingress not routing (404s/502s):** Verify your Ingress resource was parsed by the controller and the ClusterIP endpoints exist.
- **Cert not issued (Browser privacy error):** Check cert-manager challenges and certificate status:
  ```bash
  kubectl get certificate,certificaterequest,challenges -n anchorpoint-testnet
  ```

## Notes
- **Ingress Controller:** Assumes the NGINX ingress controller is deployed in the `ingress-nginx` namespace, which maps to the labels specified in the `network-policy.yaml`.
- **Cert-Manager:** Assumes cert-manager is properly installed cluster-wide with a `ClusterIssuer` identified as `letsencrypt-prod`.
- **Namespaces:** Assumes standard Kubernetes 1.21+ behavior where namespaces possess the `kubernetes.io/metadata.name` label automatically (required for the ingress NetworkPolicy targeting to work).
- **Secrets Management:** Assumes secrets (`dashboard-secrets`) are provisioned via an out-of-band process (e.g., ExternalSecrets Operator, SOPS) before running Kustomize.
