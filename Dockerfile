# Stage 1: Builder - Ubuntu 24.04 + Node.js + Python deps
FROM ubuntu:24.04 AS builder

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

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        python3 \
        python3-venv \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv "$VIRTUAL_ENV"

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
    && pip install -r requirements.txt

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# Stage 2: Runtime slicers - extract AppImages
FROM ubuntu:24.04 AS slicer-base

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /tmp

ARG PRUSA_APPIMAGE_URL="https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage"
ARG ORCA_APPIMAGE_URL="https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.1/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.1.AppImage"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
    && wget -q "$PRUSA_APPIMAGE_URL" -O PrusaSlicer.AppImage \
    && chmod +x PrusaSlicer.AppImage \
    && ./PrusaSlicer.AppImage --appimage-extract \
    && mv squashfs-root prusa-squashfs-root \
    && wget -q "$ORCA_APPIMAGE_URL" -O OrcaSlicer.AppImage \
    && chmod +x OrcaSlicer.AppImage \
    && ./OrcaSlicer.AppImage --appimage-extract \
    && mv squashfs-root orca-squashfs-root \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Stage 3: Final runtime - Ubuntu 24.04
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        python3 \
        libglu1-mesa \
        libgtk-3-0 \
        libegl1 \
        libwebkit2gtk-4.1-0 \
        libosmesa6 \
        libxft2 \
        libxinerama1 \
        libgeos-c1t64 \
        pstoedit \
        ghostscript \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /tmp/*

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app/node_modules ./node_modules

COPY --from=slicer-base /tmp/prusa-squashfs-root /opt/prusaslicer
COPY --from=slicer-base /tmp/orca-squashfs-root /opt/orcaslicer
RUN ln -sf /opt/prusaslicer/AppRun /usr/local/bin/prusa-slicer \
    && ln -sf /opt/orcaslicer/AppRun /usr/local/bin/orca-slicer \
    && groupadd --system slicer \
    && useradd --system --gid slicer \
        --create-home --home-dir /home/slicer \
        --shell /usr/sbin/nologin \
        --comment "PrusaSlicer runtime user" \
        slicer \
    && mkdir -p /app/input /app/output /home/slicer \
    && chown -R slicer:slicer /app/input /app/output /home/slicer

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY app/ ./
COPY configs/ ./configs/

USER slicer

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http=require('http');const req=http.get('http://127.0.0.1:3000/health',res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(5000,()=>{req.destroy();process.exit(1);});"

CMD ["node", "server.js"]