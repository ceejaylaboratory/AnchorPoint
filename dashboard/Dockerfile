# Stage 1: Build the dashboard
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files first for layer caching
COPY package.json package-lock.json ./

# Copy dashboard package.json
COPY dashboard/package.json ./dashboard/package.json

# Install all workspace dependencies
RUN npm ci

# Copy dashboard source code
COPY dashboard/ ./dashboard/

# Build the dashboard (TypeScript check + Vite build)
RUN npm run build -w dashboard

# Stage 2: Serve with nginx
FROM nginx:alpine AS production

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy custom nginx configuration
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static assets from builder stage
COPY --from=builder /app/dashboard/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# nginx runs as non-root by default in alpine; ensure proper permissions
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Health check via nginx process
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
