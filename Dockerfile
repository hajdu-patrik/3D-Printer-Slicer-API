# Stage 1: Builder - Prepare all dependencies
FROM node:20.14-bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    NODE_ENV=production \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# Install build dependencies + minimal runtime deps
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        wget \
        curl \
        ca-certificates \
        python3 \
        python3-venv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Build Python virtual environment in builder stage
RUN python3 -m venv "$VIRTUAL_ENV"

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
    && pip install -r requirements.txt

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# Stage 2: Runtime - PrusaSlicer preparation (AppImage extraction)
FROM node:20.14-bookworm-slim AS slicer-base

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /tmp

# Extract PrusaSlicer AppImage only (minimal runtime libs)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        wget \
        ca-certificates \
    && wget -q https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage \
        -O PrusaSlicer.AppImage \
    && chmod +x PrusaSlicer.AppImage \
    && ./PrusaSlicer.AppImage --appimage-extract \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Stage 3: Final Runtime
FROM node:20.14-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# Install only production runtime libraries
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        curl \
        libglu1-mesa \
        libgtk-3-0 \
        libegl1 \
        libwebkit2gtk-4.1-0 \
        libosmesa6 \
        libxft2 \
        libxinerama1 \
        libgeos-c1v5 \
        pstoedit \
        ghostscript \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /tmp/*

# Copy prebuilt dependencies from builder stage
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app/node_modules ./node_modules

# Copy PrusaSlicer from slicer-base stage
COPY --from=slicer-base /tmp/squashfs-root /opt/prusaslicer
RUN ln -sf /opt/prusaslicer/AppRun /usr/local/bin/prusa-slicer

# Create non-root user with minimal privileges
RUN groupadd --system --gid 1001 slicer \
    && useradd --system --uid 1001 --gid slicer \
        --create-home --home-dir /home/slicer \
        --shell /usr/sbin/nologin \
        --comment "PrusaSlicer runtime user" \
        slicer \
    && mkdir -p /app/input /app/output \
    && chown -R slicer:slicer /app /home/slicer

# Copy application code with minimal layers
COPY --chown=slicer:slicer --from=builder /app/package.json /app/package-lock.json ./
COPY --chown=slicer:slicer app/ ./
COPY --chown=slicer:slicer configs/ ./configs/

USER slicer

EXPOSE 3000

# Health check for orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
