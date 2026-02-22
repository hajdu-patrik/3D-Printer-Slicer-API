FROM node:20-bookworm-slim

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

# 1. Runtime system dependencies + PrusaSlicer setup (single layer)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        wget \
        locales \
        ca-certificates \
        python3 \
        python3-venv \
        unzip \
        libglu1-mesa \
        libgtk-3-0 \
        libegl1 \
        libgdiplus \
        libwebkit2gtk-4.1-0 \
        libosmesa6 \
        libxft2 \
        libxinerama1 \
        libgeos-c1v5 \
        pstoedit \
        ghostscript \
    && locale-gen en_US.UTF-8 \
    && wget -q https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage -O /tmp/PrusaSlicer.AppImage \
    && chmod +x /tmp/PrusaSlicer.AppImage \
    && /tmp/PrusaSlicer.AppImage --appimage-extract \
    && mv squashfs-root /opt/prusaslicer \
    && ln -sf /opt/prusaslicer/AppRun /usr/local/bin/prusa-slicer \
    && rm -f /tmp/PrusaSlicer.AppImage \
    && python3 -m venv "$VIRTUAL_ENV" \
    && apt-get purge -y --auto-remove wget \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /usr/share/doc/* /usr/share/man/*

# 3. Node.js setup
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# 4. Python dependencies
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
    && pip install -r requirements.txt

# 5. Create runtime user and writable folders (idempotent)
RUN set -eux; \
    if ! getent group slicer >/dev/null; then groupadd --system slicer; fi; \
    if ! id -u slicer >/dev/null 2>&1; then \
        useradd --system --gid slicer \
            --create-home --home-dir /home/slicer \
            --shell /usr/sbin/nologin slicer; \
    fi; \
    mkdir -p input output logs; \
    chown -R slicer:slicer /app /home/slicer

# 6. Application Files
COPY --chown=slicer:slicer app/ ./
COPY --chown=slicer:slicer configs/ ./configs/

USER slicer

EXPOSE 3000
CMD ["node", "server.js"]