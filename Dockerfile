# ==============================================================================
# Build Stage — install deps, compile TypeScript
# ==============================================================================
FROM node:20-alpine AS build

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json package-lock.json* ./

# Install all dependencies (including dev for tsc)
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Compile
RUN npx tsc


# ==============================================================================
# Production Stage — minimal runtime image
# ==============================================================================
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

LABEL org.opencontainers.image.title="filing-fee-mcp-server"
LABEL org.opencontainers.image.description="MCP server for SEC EDGAR Exhibit 107 filing fee disclosure analysis"

# Copy manifests and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

# Non-root user
RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

# Default to HTTP transport for container deployments
ARG PORT=3010
ENV MCP_TRANSPORT_TYPE="http"
ENV MCP_HTTP_PORT=${PORT}

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${MCP_HTTP_PORT}/health || exit 1

CMD ["node", "dist/index.js"]
