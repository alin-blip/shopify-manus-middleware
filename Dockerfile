FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production --no-audit --no-fund

# Copy application source
COPY src/ ./src/
COPY public/ ./public/

# Create logs directory with proper permissions (in case dev mode is used)
RUN mkdir -p logs && chmod 755 logs

# Railway injects PORT env var — default to 3000 if not set
ENV PORT=3000
ENV NODE_ENV=production

# Expose the port (informational — Railway uses PORT env var)
EXPOSE 3000

# Health check for Railway
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

# Start the server
CMD ["node", "src/server.js"]
