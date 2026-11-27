"""Orientation optimizer for print models.

Provides a deterministic, vectorized orientation search that is shared by
preprocess.py (single-process pipeline) and the legacy standalone CLI below.

Candidates: the original orientation plus the largest convex-hull faces laid
flat on the build plate. Each candidate is scored on height, overhang (support)
area and plate contact. No mesh repair of any kind is performed.
"""

import sys

import numpy as np
import trimesh

MAX_CANDIDATES = 12
OVERHANG_NORMAL_Z = -float(np.sin(np.radians(45.0)))  # normals steeper than 45 deg from vertical
PLATE_CONTACT_TOLERANCE_MM = 0.2


def _hull_candidate_rotations(mesh, max_candidates=MAX_CANDIDATES):
    """Return rotation matrices (3x3) laying the largest hull faces on the plate."""
    hull = mesh.convex_hull
    normals = np.round(hull.face_normals, 3)
    unique_normals, inverse = np.unique(normals, axis=0, return_inverse=True)
    areas = np.bincount(inverse.ravel(), weights=hull.area_faces, minlength=len(unique_normals))
    order = np.argsort(-areas, kind='stable')[:max_candidates]

    rotations = []
    down = np.array([0.0, 0.0, -1.0])
    for idx in order:
        normal = unique_normals[idx]
        length = np.linalg.norm(normal)
        if length < 1e-9:
            continue
        rotations.append(trimesh.geometry.align_vectors(normal / length, down)[:3, :3])
    return rotations


def score_orientation(vertices, face_idx, face_normals, face_areas, technology):
    """Score one candidate orientation (lower is better).

    Args:
        vertices: (V, 3) rotated vertices.
        face_idx: (F, 3) triangle indices.
        face_normals: (F, 3) rotated unit normals.
        face_areas: (F,) triangle areas.
        technology: 'FDM' or 'SLA'.

    Returns:
        (score, details dict)
    """
    z = vertices[:, 2]
    z_min = float(z.min())
    height = float(z.max() - z_min)
    extents_xy = vertices[:, :2].max(axis=0) - vertices[:, :2].min(axis=0)
    total_area = max(float(face_areas.sum()), 1e-9)
    diagonal = max(float(np.linalg.norm(vertices.max(axis=0) - vertices.min(axis=0))), 1e-9)

    face_z_max = z[face_idx].max(axis=1)
    on_plate = face_z_max <= z_min + PLATE_CONTACT_TOLERANCE_MM
    overhang_mask = (face_normals[:, 2] < OVERHANG_NORMAL_Z) & ~on_plate
    overhang_area = float(face_areas[overhang_mask].sum())
    contact_area = float(face_areas[on_plate & (face_normals[:, 2] < -0.99)].sum())

    overhang_ratio = overhang_area / total_area
    height_ratio = height / diagonal
    contact_ratio = min(1.0, 2.0 * contact_area / total_area)

    if technology.upper() == 'SLA':
        peel_ratio = float(extents_xy[0] * extents_xy[1]) / (diagonal * diagonal)
        score = height_ratio + 0.5 * overhang_ratio + 0.5 * peel_ratio
    else:
        # Support area dominates; height breaks near-ties; contact improves adhesion.
        score = 5.0 * overhang_ratio + height_ratio - 0.3 * contact_ratio

    return score, {
        'height_mm': height,
        'overhang_area_mm2': overhang_area,
        'contact_area_mm2': contact_area,
    }


def find_best_orientation(mesh, technology='FDM'):
    """Pick the best orientation. Does not modify the mesh.

    Returns:
        (rotation 3x3 ndarray, details dict). Identity wins ties (deterministic).
    """
    candidates = [np.eye(3)]
    try:
        candidates.extend(_hull_candidate_rotations(mesh))
    except Exception as exc:  # hull failure (degenerate/flat) -> keep original orientation
        print(f"[PYTHON ORIENT] Warning: convex hull candidates unavailable ({exc}). Keeping original.")

    base_vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces)
    normals = np.asarray(mesh.face_normals, dtype=np.float64)
    areas = np.asarray(mesh.area_faces, dtype=np.float64)

    best = None
    for index, rot in enumerate(candidates):
        score, details = score_orientation(base_vertices @ rot.T, faces, normals @ rot.T, areas, technology)
        if best is None or score < best[0] - 1e-12:
            best = (score, rot, details, index)

    score, rot, details, index = best
    details = dict(details, candidate_index=index, candidates=len(candidates), score=score)
    print(
        f"[PYTHON ORIENT] {technology}: chose candidate {index}/{len(candidates) - 1} "
        f"height={details['height_mm']:.2f}mm overhang={details['overhang_area_mm2']:.1f}mm^2"
    )
    return rot, details


def apply_rotation(mesh, rotation):
    """Rotate mesh in place around the origin by a 3x3 matrix."""
    if np.allclose(rotation, np.eye(3)):
        return
    matrix = np.eye(4)
    matrix[:3, :3] = rotation
    mesh.apply_transform(matrix)


def optimize_orientation(input_path, output_path, technology='FDM'):
    """Legacy CLI entry: orient an STL and export it (prefer preprocess.py)."""
    try:
        mesh = trimesh.load(input_path)
        if isinstance(mesh, trimesh.Scene):
            mesh = trimesh.util.concatenate(mesh.dump())
        rotation, _ = find_best_orientation(mesh, technology)
        apply_rotation(mesh, rotation)
        mesh.apply_translation(-mesh.centroid)
        mesh.apply_translation([0, 0, -float(mesh.bounds[0][2])])
        mesh.export(output_path)
        print(f"[PYTHON ORIENT] Success! Saved to {output_path}")
    except Exception as exc:
        print(f"[PYTHON ORIENT] ERROR: Could not optimize orientation from this input file. {exc}")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 orient.py input.stl output.stl [FDM/SLA]")
        sys.exit(1)
    optimize_orientation(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "FDM")
