# ---- Build Stage ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy app source
COPY . .

# Disable telemetry
ENV NEXT_TELEMETRY_DISABLED 1

# Build Next.js app
RUN npm run build

# ---- Run Stage ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

# Create a non-root user
RUN useradd -m nextjs
USER nextjs

# Copy only what's needed
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 8080

# Start the app
CMD ["npm", "start"]
