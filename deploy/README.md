# Deploy

## Grafana

Dashboards and provisioning for Grafana live in [`grafana/`](grafana/README.md).

## Canary deployments (Argo Rollouts)

Backend releases go out as a canary defined in
[`infra/k8s/rollouts/backend-rollout.yaml`](../infra/k8s/rollouts/backend-rollout.yaml):

| Step | Traffic to new version | Gate |
|------|------------------------|------|
| 1 | 10% | pause 5 minutes |
| 2 | 33% | pause 10 minutes |
| 3 | 100% | promoted to stable |

Throughout the rollout the `backend-canary-health` AnalysisTemplate queries
Prometheus for the canary pods' 5xx error rate and p99 latency. If the error
rate exceeds **1%** (or p99 latency exceeds 1s), the rollout aborts and all
traffic returns to the stable version with no downtime.

### One-time setup

```bash
# Argo Rollouts controller and kubectl plugin
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
brew install argoproj/tap/kubectl-argo-rollouts   # or download the plugin binary

# Helm release keeps the Deployment at 0 replicas; the Rollout owns the pods
helm upgrade --install anchor-point ./infra/helm/anchor-point \
  -f infra/helm/anchor-point/values-prod.yaml \
  --namespace anchorpoint-prod --create-namespace \
  --set replicaCount=0

kubectl apply -f infra/k8s/rollouts/backend-rollout.yaml
```

### Releasing a new version

```bash
# Change the image (or any pod template value) through Helm — this starts a canary
helm upgrade anchor-point ./infra/helm/anchor-point \
  -f infra/helm/anchor-point/values-prod.yaml \
  --namespace anchorpoint-prod \
  --set replicaCount=0 \
  --set image.tag=<git-sha-or-semver>

# Watch progress, weights and analysis results
kubectl argo rollouts get rollout anchor-point -n anchorpoint-prod --watch
```

### Operating a rollout

```bash
# Skip the current pause and move to the next step
kubectl argo rollouts promote anchor-point -n anchorpoint-prod

# Skip all remaining steps and analysis (emergencies only)
kubectl argo rollouts promote anchor-point -n anchorpoint-prod --full

# Abort: shift 100% of traffic back to stable immediately
kubectl argo rollouts abort anchor-point -n anchorpoint-prod

# After an abort, return to the stable version as the desired state
kubectl argo rollouts undo anchor-point -n anchorpoint-prod

# Re-run a failed/aborted rollout
kubectl argo rollouts retry rollout anchor-point -n anchorpoint-prod

# Inspect analysis runs
kubectl get analysisrun -n anchorpoint-prod
kubectl describe analysisrun <name> -n anchorpoint-prod
```

### Testing automatic rollback

Deploy an image that returns HTTP 500 on a frequently-hit route (or point a
load generator at an endpoint that fails on the canary only), then watch the
rollout: within one or two analysis intervals `canary-error-rate` fails, the
rollout status changes to `Degraded`, and traffic weight returns to 0% for the
canary.
