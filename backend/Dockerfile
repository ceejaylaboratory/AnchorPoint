# =============================================================================
# Stage 1: builder — installs ALL dependencies and compiles TypeScript
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first to maximise layer-cache reuse.
# These layers are only invalidated when package*.json files change.
COPY package.json package-lock.json ./

# Install all dependencies including devDependencies needed for the build step.
# --no-audit/--no-fund skip two network round-trips that produce output nobody
# reads in a build log; --ignore-scripts keeps a dependency's install script
# from running arbitrary code before the source is even present.
RUN npm ci --ignore-scripts --no-audit --no-fund

# Copy application source after dependencies to keep the install layer cached.
COPY . .

# Compile TypeScript → dist/ and generate Prisma client artefacts.
RUN npm run build && npx prisma generate

# =============================================================================
# Stage 2: prod-deps — a production-only node_modules built from scratch
# =============================================================================
# The runtime stage must not inherit the builder's node_modules: that tree has
# been through a dev install plus a `npm prune`, and pruning edits the tree in
# place — it does not remove files that a dev dependency wrote outside its own
# directory, so leftovers survive into the published image. A separate
# `npm ci --omit=dev` is slower by one install but produces a tree that is
# exactly the production dependency set.
FROM node:20-alpine AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

# --ignore-scripts skips the root `postinstall: prisma generate`, because the
# Prisma CLI is a devDependency and is not installed in this stage. The client
# is therefore copied from the builder below instead of re-generating it with
# `npx prisma`, which would download the CLI on every build.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# The generated client (schema-specific code plus the query engine binary) is
# written to node_modules/.prisma by the builder's `prisma generate`. @prisma/
# client itself is a production dependency and is already installed above; it
# only re-exports from this directory.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# =============================================================================
# Stage 3: runner — minimal production image with no build toolchain
# =============================================================================
FROM node:20-alpine AS runner

# Runtime utilities:
#   dumb-init  — proper PID-1 signal handling and zombie-process reaping
#   wget       — lightweight health-check probe (no curl needed)
RUN apk add --no-cache dumb-init wget

WORKDIR /app

ENV NODE_ENV=production

# Copy only the artefacts needed at runtime. Nothing from the build toolchain
# (TypeScript compiler, devDependencies, npm cache) ever enters this image.
COPY --from=prod-deps /app/node_modules      ./node_modules
COPY --from=builder  /app/package*.json      ./
COPY --from=builder  /app/dist               ./dist
COPY --from=builder  /app/prisma             ./prisma
COPY --from=builder  /app/tools              ./tools
COPY --from=builder  /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Run as the unprivileged 'node' user supplied by the official Node image.
USER node

# Backend API port
EXPOSE 3002

# Orchestrator health-check (docker-compose, k8s liveness probe, etc.)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
