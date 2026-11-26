# Production Docker Compose — Healthcheck & Volume Verification

## Context
Issue #102 requested healthchecks and volume persistence for docker-compose.prod.yml.
On inspection, these were already implemented. This document records verification.

## Verified in docker-compose.prod.yml
- postgres: `pg_isready` healthcheck (interval 10s, retries 5, start_period 10s)
- redis: `redis-cli -a $REDIS_PASSWORD ping` healthcheck
- backend-1/2/3 (via x-backend-common anchor): wget liveness check against `/health/live`
  (interval 10s, timeout 5s, retries 3, start_period 40s so migrations and secret/KMS
  hydration finish before failed probes count; issue #1668)
- dashboard: wget health endpoint check against `/health`
- All dependent services use `condition: service_healthy` in `depends_on`
- Named persistent volumes: `postgres-data`, `redis-data`

## Local Validation
Result: config validated with no errors. All services reached `healthy` status.

## Conclusion
No functional changes were required to `docker-compose.prod.yml`. This verification
closes out issue #102's requirements.
EOF