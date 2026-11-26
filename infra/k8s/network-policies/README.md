# Kubernetes Network Policies - Issue #1690

Egress lockdown for the AnchorPoint data stores and the pods that use them.
Requires a CNI that enforces NetworkPolicy (Calico, Cilium, AWS VPC CNI with
network policy enabled, GKE Dataplane V2, ...).

## Files

| File | Policy | Effect |
| --- | --- | --- |
| `default-deny-egress.yaml` | `default-deny-egress` | Postgres and Redis pods can't open any outbound connection except cluster DNS |
| `datastore-ingress.yaml` | `postgres-allow-backend-ingress`, `redis-allow-backend-ingress` | Only backend and worker pods can reach 5432 (Postgres) and 6379 (Redis) |
| `backend-egress.yaml` | `backend-restrict-egress`, `worker-restrict-egress` | Backend and worker pods can only reach cluster DNS, Postgres/Redis and external HTTPS (443) on public IPs |

Pods are selected by the labels the Helm chart and worker manifest already set:

| Pods | Labels |
| --- | --- |
| Postgres | `app.kubernetes.io/component: postgres` |
| Redis | `app.kubernetes.io/component: redis` |
| Backend | `app.kubernetes.io/component: backend` |
| Worker | `app: anchorpoint`, `component: worker` |

## Apply

Apply to every namespace that runs AnchorPoint workloads:

```bash
kubectl apply -f infra/k8s/network-policies/ -n anchorpoint-prod
kubectl get networkpolicy -n anchorpoint-prod
```

## External endpoints

Standard NetworkPolicy matches IPs, not hostnames. The backend and worker
policies allow HTTPS to any public IP and exclude private ranges and the cloud
metadata endpoint (`169.254.169.254`). To pin egress to the designated Stellar
Horizon / Soroban RPC endpoints:

- replace `0.0.0.0/0` in `backend-egress.yaml` with the endpoints' CIDRs, or
- on Cilium, use a `CiliumNetworkPolicy` with `toFQDNs` listing the Horizon
  and RPC hostnames (for example `horizon.stellar.org`).

Postgres and Redis ports (5432, 6379) are allowed to any destination so
managed instances (RDS, ElastiCache) outside the cluster keep working.

## Verify

```bash
NS=anchorpoint-prod
PG=$(kubectl get pod -n $NS -l app.kubernetes.io/component=postgres -o name | head -1)
BACKEND=$(kubectl get pod -n $NS -l app.kubernetes.io/component=backend -o name | head -1)

# 1. Outbound internet from the database is dropped (expect a timeout)
kubectl exec -n $NS $PG -- sh -c 'wget -q -T 5 -O- https://example.com || echo "blocked"'

# 2. Cluster DNS still resolves from the database pod
kubectl exec -n $NS $PG -- nslookup kubernetes.default.svc.cluster.local

# 3. Backend can reach Postgres and Redis
kubectl exec -n $NS $BACKEND -- sh -c 'nc -zv -w 5 anchor-point-postgres 5432; nc -zv -w 5 anchor-point-redis 6379'

# 4. Any other pod cannot reach Postgres (expect a timeout)
kubectl run np-test -n $NS --rm -it --image=busybox:1.36 --restart=Never -- \
  nc -zv -w 5 anchor-point-postgres 5432

# 5. Backend can still reach Horizon
kubectl exec -n $NS $BACKEND -- wget -q -T 5 -O- https://horizon.stellar.org >/dev/null && echo "horizon ok"
```
