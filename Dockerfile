# ---------- Builder: build Python wheels ----------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps needed to compile some Python packages (adjust if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Build wheels so we can install without keeping build toolchain in final image
RUN pip install --upgrade pip wheel setuptools && \
    pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


# ---------- Runtime: minimal image ----------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install wheels from builder
COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt && \
    rm -rf /wheels

# Copy project files
RUN addgroup --system --gid 998 appgroup && \
    adduser --system --uid 998 --ingroup appgroup appuser

COPY --chown=appuser:appgroup . .

RUN mkdir -p /app/staticfiles /app/media && \
    chown -R appuser:appgroup /app/staticfiles /app/media

USER appuser

EXPOSE 8000

CMD ["hypercorn", "app.asgi:application", "-b", "0.0.0.0:8000", "-w", "2", "--keep-alive", "15"]
