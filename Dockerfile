FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    NODE_ENV=production

WORKDIR /app

# 1. System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl unzip git \
    libglu1-mesa libgtk-3-0 libegl1 libgdiplus libwebkit2gtk-4.1-0 \
    libosmesa6-dev \
    libxft2 libxinerama1 \
    locales ca-certificates \
    nodejs npm \
    python3 python3-pip python3-numpy python3-pil python3-scipy \
    libgeos-dev pstoedit ghostscript \
    && locale-gen en_US.UTF-8 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. PrusaSlicer Setup
RUN wget -q https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage -O PrusaSlicer.AppImage \
    && chmod +x PrusaSlicer.AppImage \
    && ./PrusaSlicer.AppImage --appimage-extract \
    && mv squashfs-root /opt/prusaslicer \
    && ln -s /opt/prusaslicer/AppRun /usr/local/bin/prusa-slicer \
    && rm PrusaSlicer.AppImage

# 3. Node.js setup
COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install && npm audit fix --force

# 4. Python dependencies & SECURITY FIX
RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install --upgrade setuptools --break-system-packages && \
    pip3 install trimesh[easy] ezdxf shapely svg.path gmsh numpy-stl scipy --break-system-packages

# 5. Application Files
COPY app/ ./
COPY configs/ ./configs/

# Create folders
RUN mkdir -p input output logs

EXPOSE 3000
CMD ["node", "server.js"]