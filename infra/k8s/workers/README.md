# Kubernetes Worker Deployment - Issue #416

This directory contains the Kubernetes deployment manifest for AnchorPoint worker services.

## Files

- `deployment.yaml` - Complete Kubernetes manifest including ConfigMap, Secret, Deployment, and Service

## Manual QA Steps

### 1. Validate YAML Syntax
```bash
# Install yamllint if not already installed
pip install yamllint

# Lint the deployment file
yamllint deployment.yaml
```

### 2. Deploy to Cluster
```bash
# Apply the manifest to your testnet cluster
kubectl apply -f deployment.yaml -n anchorpoint-testnet

# Verify the namespace exists
kubectl create namespace anchorpoint-testnet --dry-run=client -o yaml | kubectl apply -f -
```

### 3. Verify Deployment
```bash
# Check pods are running
kubectl get pods -n anchorpoint-testnet -l app=anchorpoint,component=worker

# Check service is accessible
kubectl get svc -n anchorpoint-testnet anchorpoint-worker-svc

# Check logs
kubectl logs -n anchorpoint-testnet -l app=anchorpoint,component=worker

# Verify health endpoint
kubectl exec -n anchorpoint-testnet deploy/anchorpoint-worker -- curl -s http://localhost:3002/health
```

### 4. Verify Resource Configuration
```bash
# Check resource requests/limits
kubectl describe pod -n anchorpoint-testnet -l app=anchorpoint,component=worker | grep -A5 "Limits\|Requests"

# Check probe configuration
kubectl describe pod -n anchorpoint-testnet -l app=anchorpoint,component=worker | grep -A10 "Liveness\|Readiness"
```

### 5. Cleanup
```bash
# Delete the deployment
kubectl delete -f deployment.yaml -n anchorpoint-testnet
```

## Resource Sizing Guidelines

Every container must declare explicit CPU and memory requests and limits so a single container cannot exhaust node memory and trigger the kernel OOM killer against neighbouring pods.

| Container | CPU request | Memory request | CPU limit | Memory limit | Node.js heap cap |
|-----------|-------------|----------------|-----------|--------------|------------------|
| Backend (`docker-compose.prod.yml`) | 250m | 512Mi | 1000m | 1.5Gi | `--max-old-space-size=1200` |
| Worker (`deployment.yaml`) | 200m | 384Mi | 800m | 1Gi | `--max-old-space-size=768` |

- Set `--max-old-space-size` (via `NODE_OPTIONS`) to roughly 75–80% of the container memory limit. V8 then runs garbage collection before the heap reaches the cgroup ceiling, leaving headroom for buffers, native modules and the stack.
- If you raise or lower a memory limit, change the heap cap with it.
- Supporting containers in `docker-compose.prod.yml` (proxy, dashboard, Postgres, Redis, Jaeger, smoke test) also have `deploy.resources` reservations and limits.
- Watch for `OOMKilled` in `kubectl describe pod` or `kubectl get pods` restart counts. Repeated OOM kills mean the limit (and heap cap) should be raised, or `QUEUE_CONCURRENCY` lowered.

## Security Notes

- **Never** commit actual secrets to this file
- Redis URL is stored as a Kubernetes Secret (base64-encoded)
- Use `kubectl create secret` or external secret operators in production
- All labels use `environment: testnet` for proper isolation