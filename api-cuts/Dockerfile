# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

WORKDIR /app

# yt-dlp requires ffmpeg; we pull the yt-dlp static binary directly
# so we don't need Python in the image (keeps it lean).
RUN apk add --no-cache ffmpeg curl && \
    curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist

# SQLite data dir (mounted as a named volume)
RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "dist/app.js"]
