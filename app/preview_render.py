"""Isometric PNG preview renderer for prepared print models.

Pure CPU rendering with Pillow (painter's algorithm + Lambert shading), so the
container needs no OpenGL/OSMesa stack. The mesh is rendered exactly as it will
be sliced (already oriented, transformed and placed on the build plate).
"""

import numpy as np
from PIL import Image, ImageDraw

BACKGROUND = (245, 246, 248)
MODEL_COLOR = np.array([66, 135, 245], dtype=float)
PLATE_COLOR = (205, 210, 218)
LIGHT_DIR = np.array([-0.35, 0.45, 0.82])
SUPERSAMPLE = 2
LOD_FACE_THRESHOLD = 40_000
LOD_CELL_OUTPUT_PX = 2.0


def _view_rotation():
    """Classic isometric camera: rotate -45 deg about Z, then tilt ~35.26 deg about X."""
    yaw = np.radians(-45.0)
    pitch = np.radians(54.7356)
    rz = np.array([[np.cos(yaw), -np.sin(yaw), 0], [np.sin(yaw), np.cos(yaw), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, np.cos(pitch), -np.sin(pitch)], [0, np.sin(pitch), np.cos(pitch)]])
    return rx @ rz


def _cluster_vertices(vertices, faces, cell):
    """Vertex-clustering LOD: merge vertices sharing a grid cell, drop collapsed and duplicate faces.

    Used only for the preview image (never for slicing), so sub-pixel detail can be merged safely.
    """
    grid = np.floor(vertices / cell).astype(np.int64)
    grid -= grid.min(axis=0)
    dims = grid.max(axis=0) + 1
    flat_keys = (grid[:, 0] * dims[1] + grid[:, 1]) * dims[2] + grid[:, 2]
    _, inverse = np.unique(flat_keys, return_inverse=True)
    inverse = inverse.reshape(-1)
    cluster_count = int(inverse.max()) + 1
    sums = np.zeros((cluster_count, 3))
    np.add.at(sums, inverse, vertices)
    counts = np.bincount(inverse, minlength=cluster_count)[:, None]
    merged = sums / counts

    remapped = inverse[faces]
    keep = (remapped[:, 0] != remapped[:, 1]) & (remapped[:, 1] != remapped[:, 2]) & (remapped[:, 0] != remapped[:, 2])
    remapped = remapped[keep]
    ordered = np.sort(remapped, axis=1)
    face_keys = (ordered[:, 0] * cluster_count + ordered[:, 1]) * cluster_count + ordered[:, 2]
    _, unique_index = np.unique(face_keys, return_index=True)
    return merged, remapped[np.sort(unique_index)]


def _face_normals(vertices, faces):
    """Unit normals from triangle winding."""
    tri = vertices[faces]
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.where(length > 0, length, 1.0)


def render_preview(mesh, output_path, size=512):
    """Render an isometric shaded PNG of the mesh and return (width, height)."""
    rotation = _view_rotation()
    vertices = mesh.vertices @ rotation.T
    faces = np.asarray(mesh.faces)

    canvas = size * SUPERSAMPLE
    margin = 0.08 * canvas

    plate = _plate_corners(mesh) @ rotation.T
    frame_xy = np.vstack([vertices[:, :2], plate[:, :2]])
    lo, hi = frame_xy.min(axis=0), frame_xy.max(axis=0)

    if len(faces) > LOD_FACE_THRESHOLD:
        world_per_output_px = max(float((hi - lo).max()), 1e-9) / ((canvas - 2 * margin) / SUPERSAMPLE)
        vertices, faces = _cluster_vertices(vertices, faces, world_per_output_px * LOD_CELL_OUTPUT_PX)

    normals = _face_normals(vertices, faces)
    visible = normals[:, 2] > 1e-6
    faces, normals = faces[visible], normals[visible]

    xy = vertices[:, :2]
    span = max(float((hi - lo).max()), 1e-9)
    scale = (canvas - 2 * margin) / span
    offset = (canvas - (hi - lo) * scale) / 2
    screen = (xy - lo) * scale + offset
    screen[:, 1] = canvas - screen[:, 1]

    light = LIGHT_DIR / np.linalg.norm(LIGHT_DIR)
    intensity = 0.28 + 0.72 * np.clip(normals @ light, 0.0, 1.0)
    colors = np.clip(MODEL_COLOR[None, :] * intensity[:, None], 0, 255).astype(np.uint8)

    depth = vertices[faces][:, :, 2].mean(axis=1)
    order = np.argsort(depth)

    image = Image.new("RGB", (canvas, canvas), BACKGROUND)
    draw = ImageDraw.Draw(image)
    plate_screen = (plate[:, :2] - lo) * scale + offset
    plate_screen[:, 1] = canvas - plate_screen[:, 1]
    draw.polygon([tuple(p) for p in plate_screen], fill=PLATE_COLOR)

    polygons = screen[faces[order]].reshape(len(order), 6).tolist()
    fills = [tuple(color) for color in colors[order].tolist()]
    polygon = draw.polygon
    for points, fill in zip(polygons, fills):
        polygon(points, fill=fill)

    image = image.resize((size, size), Image.LANCZOS)
    image.save(output_path, format="PNG", compress_level=6)
    return size, size


def _plate_corners(mesh):
    """Model XY footprint rectangle at Z=0, drawn as a simple build-plate cue."""
    (min_x, min_y, _), (max_x, max_y, _) = mesh.bounds
    return np.array([[min_x, min_y, 0], [max_x, min_y, 0], [max_x, max_y, 0], [min_x, max_y, 0]], dtype=float)
