FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8

WORKDIR /app

# 1. System dependencies & Locale generation (Merged layer)
RUN apt-get update && apt-get install -y \
    wget curl unzip git \
    libglu1-mesa libgtk-3-0 libegl1 libgdiplus libwebkit2gtk-4.1-0 \
    locales ca-certificates \
    nodejs npm \
    python3 python3-pip python3-numpy python3-pil python3-scipy \
    libgeos-dev \
    && rm -rf /var/lib/apt/lists/* \
    && locale-gen en_US.UTF-8

# 2. PrusaSlicer Setup
RUN wget https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1+linux-x64-newer-distros-GTK3-202409181416.AppImage -O PrusaSlicer.AppImage \
    && chmod +x PrusaSlicer.AppImage \
    && ./PrusaSlicer.AppImage --appimage-extract \
    && mv squashfs-root /opt/prusaslicer \
    && ln -s /opt/prusaslicer/AppRun /usr/local/bin/prusa-slicer \
    && rm PrusaSlicer.AppImage

# 3. Node.js setup
COPY package.json .
RUN npm install

# 4. Python dependencies
RUN pip3 install trimesh[easy] ezdxf shapely svg.path --break-system-packages

# 5. Application Files
COPY app/img2stl.py .
COPY app/vector2stl.py .
COPY app/server.js .
COPY configs/ ./configs/

# Create folders
RUN mkdir -p input/slicing-helper-files && mkdir -p output

EXPOSE 3000
CMD ["node", "server.js"]