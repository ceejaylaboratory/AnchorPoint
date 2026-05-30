# -----------------------------------------------------------------------------
# Stage 1: Shared base image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base

WORKDIR /app

# -----------------------------------------------------------------------------
# Stage 2: Install dependencies once (cached by package lock changes)
# -----------------------------------------------------------------------------
FROM base AS deps

ENV NODE_ENV=development

# Copy only dependency manifests first to maximize Docker cache reuse
COPY package*.json ./
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 3: Build application and prune dev dependencies
# -----------------------------------------------------------------------------
FROM deps AS build

# Copy application source after dependency installation to preserve cache layers
COPY . .

# Build TypeScript output and generate Prisma client artifacts.
# Afterwards prune dev dependencies to keep runtime image smaller.
RUN npm run build \
  && npx prisma generate \
  && npm prune --omit=dev \
  && npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 4: Runtime image (small, secure, production-only)
# -----------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

# Runtime utilities:
# - dumb-init for proper signal handling and zombie reaping
# - wget for container health checks
RUN apk add --no-cache dumb-init wget

# Copy only runtime assets from build stage
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Use non-root user provided by official Node image
USER node

# Expose backend port
EXPOSE 3002

# Health check endpoint used by orchestrators and compose
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
