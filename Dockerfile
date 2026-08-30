# ── Dockerfile ─────────────────────────────────────────────────────────────
# Single container with Python 3.11 + Node.js 20 LTS.
# The Node.js Express server manages the Python ML worker as a subprocess.
# No Flask. No separate service. One container, one port.

FROM python:3.11-slim

# ── System dependencies ────────────────────────────────────────────────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    # Install Node.js 20 LTS
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    # Cleanup
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python dependencies (heaviest layer — cached unless requirements change) ─
COPY python_service/requirements.txt ./python_service/requirements.txt
RUN pip install --no-cache-dir -r python_service/requirements.txt

# ── Node.js dependencies ───────────────────────────────────────────────────
COPY package*.json ./
RUN npm ci --only=production

# ── Application source ─────────────────────────────────────────────────────
COPY . .

# ── Runtime ───────────────────────────────────────────────────────────────
# Render injects $PORT automatically. Express reads process.env.PORT.
EXPOSE 3000

CMD ["node", "server.js"]
