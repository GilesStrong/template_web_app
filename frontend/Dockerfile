FROM node:20-bookworm-slim

WORKDIR /app

# Install system dependencies required by Playwright Chromium
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libx11-6 \
    libxcb1 \
    libxext6 \
    libxrender1 \
    libxcursor1 \
    libxi6 \
    libxtst6 \
    libfontconfig1 \
    fonts-liberation \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install bun (package manager)
RUN npm i -g bun@1.3.9

# Copy only manifests for caching
COPY package.json bun.lockb ./

# Install deps
RUN bun install --frozen-lockfile

# Install Playwright Chromium browser at build time for deterministic E2E runs
RUN bunx playwright install chromium

# Copy app
COPY . .

EXPOSE 3001

# Run Next using Node (NOT bun runtime)
CMD ["node", "node_modules/next/dist/bin/next", "dev", "-H", "0.0.0.0", "-p", "3001"]
