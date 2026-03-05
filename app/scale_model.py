"""Scale and rotate STL models for slicing preprocessing.

Usage:
    python3 scale_model.py input.stl output.stl sx sy sz rx ry rz

Where:
- sx/sy/sz are scaling factors (positive floats)
- rx/ry/rz are rotation angles in degrees
"""

import math
import shutil
import sys

import numpy as np
import trimesh


def _load_as_mesh(input_path: str) -> trimesh.Trimesh:
    """Load a mesh or merge scene geometries into one mesh."""
    mesh = trimesh.load(input_path)
    if isinstance(mesh, trimesh.Scene):
        if not mesh.geometry:
            raise ValueError("The input model does not contain any geometry.")
        mesh = trimesh.util.concatenate(mesh.dump())
    return mesh


def _to_transform_matrix(scale_x: float, scale_y: float, scale_z: float) -> np.ndarray:
    """Build 4x4 non-uniform scale transform matrix.

    Args:
        scale_x: Scale factor on X axis.
        scale_y: Scale factor on Y axis.
        scale_z: Scale factor on Z axis.

    Returns:
        Homogeneous 4x4 scaling matrix.
    """
    matrix = np.eye(4)
    matrix[0, 0] = scale_x
    matrix[1, 1] = scale_y
    matrix[2, 2] = scale_z
    return matrix


def _apply_rotations(mesh: trimesh.Trimesh, rot_x_deg: float, rot_y_deg: float, rot_z_deg: float) -> None:
    """Apply intrinsic X->Y->Z rotations around the model origin."""
    rotations = [
        (rot_x_deg, [1, 0, 0]),
        (rot_y_deg, [0, 1, 0]),
        (rot_z_deg, [0, 0, 1]),
    ]

    for angle_deg, axis in rotations:
        if abs(angle_deg) < 1e-12:
            continue
        angle_rad = math.radians(angle_deg)
        transform = trimesh.transformations.rotation_matrix(angle_rad, axis)
        mesh.apply_transform(transform)


def _place_on_build_plate(mesh: trimesh.Trimesh) -> None:
    """Center model in XY and place lowest point at Z=0."""
    mesh.apply_translation(-mesh.centroid)
    min_z = float(mesh.bounds[0][2])
    mesh.apply_translation([0, 0, -min_z])


def transform_model(
    input_path: str,
    output_path: str,
    scale_x: float,
    scale_y: float,
    scale_z: float,
    rot_x_deg: float,
    rot_y_deg: float,
    rot_z_deg: float,
) -> None:
    """Scale and rotate model, then export as STL."""
    if scale_x <= 0 or scale_y <= 0 or scale_z <= 0:
        raise ValueError("Scale factors must be positive values.")

    mesh = _load_as_mesh(input_path)

    mesh.apply_translation(-mesh.centroid)
    mesh.apply_transform(_to_transform_matrix(scale_x, scale_y, scale_z))
    _apply_rotations(mesh, rot_x_deg, rot_y_deg, rot_z_deg)
    _place_on_build_plate(mesh)

    mesh.export(output_path)


def _parse_args(argv: list[str]) -> tuple[str, str, float, float, float, float, float, float]:
    """Parse CLI arguments for transformation operation.

    Args:
        argv: Raw command line argument list.

    Returns:
        Tuple of input path, output path, scale factors and rotation angles.

    Raises:
        ValueError: If argument count is invalid.
    """
    if len(argv) != 9:
        raise ValueError(
            "Usage: python3 scale_model.py input.stl output.stl sx sy sz rx ry rz"
        )

    input_path = argv[1]
    output_path = argv[2]

    sx = float(argv[3])
    sy = float(argv[4])
    sz = float(argv[5])
    rx = float(argv[6])
    ry = float(argv[7])
    rz = float(argv[8])

    return input_path, output_path, sx, sy, sz, rx, ry, rz


if __name__ == "__main__":
    try:
        args = _parse_args(sys.argv)
        transform_model(*args)
        print(f"[PYTHON SCALE] Success! Saved transformed model: {args[1]}")
    except Exception as exc:
        print(f"[PYTHON SCALE] ERROR: {exc}")
        if len(sys.argv) >= 3:
            try:
                shutil.copy2(sys.argv[1], sys.argv[2])
            except Exception:
                pass
        sys.exit(1)
