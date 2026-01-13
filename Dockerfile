FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and .npmrc for Azure Artifacts auth
COPY package*.json ./
COPY .npmrc ./

# NPM_TOKEN is passed as build arg for Azure Artifacts authentication
ARG NPM_TOKEN
RUN if [ -n "$NPM_TOKEN" ]; then \
      echo "//pkgs.dev.azure.com/sineai/_packaging/internal/npm/registry/:_authToken=${NPM_TOKEN}" >> .npmrc; \
    fi && \
    npm ci --ignore-scripts && \
    rm -f .npmrc

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# Install wget for healthcheck and create non-root user
RUN apk add --no-cache wget && \
    addgroup -g 1001 -S mcp && adduser -S mcp -u 1001 -G mcp
COPY package*.json ./
COPY .npmrc ./

# NPM_TOKEN for production dependencies
ARG NPM_TOKEN
RUN if [ -n "$NPM_TOKEN" ]; then \
      echo "//pkgs.dev.azure.com/sineai/_packaging/internal/npm/registry/:_authToken=${NPM_TOKEN}" >> .npmrc; \
    fi && \
    npm ci --production --ignore-scripts && \
    npm cache clean --force && \
    rm -f .npmrc

COPY --from=builder /app/dist ./dist
RUN chown -R mcp:mcp /app
USER mcp
ENV MCP_MODE=remote PORT=3000 NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
EXPOSE 3000
CMD ["node", "dist/index.js"]
