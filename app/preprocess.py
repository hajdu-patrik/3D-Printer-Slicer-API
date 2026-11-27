"""Single-process geometry preprocessing for the slicing pipeline.

Modes:
    python3 preprocess.py preprocess INPUT OUTPUT.stl [--technology FDM|SLA] [--auto-orient 1|0]
    python3 preprocess.py transform  INPUT OUTPUT.stl --scale SX SY SZ --rotate RX RY RZ

Both modes export an STL placed on the build plate (centered in XY, min Z = 0)
and print exactly one result line on stdout:

    @@RESULT@@{"x":..,"y":..,"z":..,"volume_mm3":..,"surface_area_mm2":..,
               "is_watertight":..,"triangle_count":..,...}

No model healing or repair is performed. Errors go to stderr with exit code 1;
load failures use wording that errors.js maps to INVALID_SOURCE_GEOMETRY.
"""

import argparse
import json
import math
import sys

import numpy as np
import trimesh

RESULT_MARKER = "@@RESULT@@"


class SourceGeometryError(Exception):
    """Input could not be read as printable mesh geometry."""


def load_mesh(input_path):
    """Load a mesh file (STL/OBJ/3MF/PLY) into one Trimesh without any repair."""
    try:
        mesh = trimesh.load(input_path)
    except FileNotFoundError:
        raise
    except Exception as exc:
        raise SourceGeometryError(f"Invalid mesh file. {exc}") from exc

    if isinstance(mesh, trimesh.Scene):
        if not mesh.geometry:
            raise SourceGeometryError("The uploaded file does not contain mesh geometry.")
        mesh = trimesh.util.concatenate(mesh.dump())

    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0 or len(mesh.vertices) == 0:
        raise SourceGeometryError("The uploaded file does not contain mesh geometry.")
    return mesh


def place_on_build_plate(mesh):
    """Center in XY (centroid) and rest the lowest point on Z=0."""
    mesh.apply_translation(-mesh.centroid)
    mesh.apply_translation([0, 0, -float(mesh.bounds[0][2])])


def build_result(mesh, **extra):
    """Collect dimensions (from trimesh bounds) and geometry stats."""
    x, y, z = (float(v) for v in mesh.extents)
    watertight = bool(mesh.is_watertight)
    result = {
        "x": round(x, 4),
        "y": round(y, 4),
        "z": round(z, 4),
        "volume_mm3": round(abs(float(mesh.volume)), 4) if watertight else 0.0,
        "surface_area_mm2": round(float(mesh.area), 4),
        "is_watertight": watertight,
        "triangle_count": int(len(mesh.faces)),
    }
    result.update(extra)
    return result


def emit_result(result):
    print(f"{RESULT_MARKER}{json.dumps(result, separators=(',', ':'))}")


def run_preprocess(input_path, output_path, technology="FDM", auto_orient=True):
    """Load, optionally orient, place on plate, export STL and emit stats."""
    from orient import apply_rotation, find_best_orientation

    mesh = load_mesh(input_path)
    extra = {"auto_oriented": False}
    if auto_orient:
        try:
            rotation, details = find_best_orientation(mesh, technology)
            apply_rotation(mesh, rotation)
            extra = {
                "auto_oriented": details["candidate_index"] != 0,
                "overhang_area_mm2": round(details["overhang_area_mm2"], 4),
            }
        except Exception as exc:
            print(f"[PYTHON PREPROCESS] Warning: orientation skipped ({exc}).")
    place_on_build_plate(mesh)
    mesh.export(output_path)
    emit_result(build_result(mesh, **extra))


def run_transform(input_path, output_path, scale, rotate_deg):
    """Scale (about centroid), rotate X->Y->Z, place on plate, export, emit stats."""
    if any(s <= 0 or not math.isfinite(s) for s in scale):
        raise ValueError("Scale factors must be positive values.")
    mesh = load_mesh(input_path)
    mesh.apply_translation(-mesh.centroid)
    matrix = np.eye(4)
    matrix[0, 0], matrix[1, 1], matrix[2, 2] = scale
    mesh.apply_transform(matrix)
    for angle, axis in zip(rotate_deg, ([1, 0, 0], [0, 1, 0], [0, 0, 1])):
        if abs(angle) >= 1e-12:
            mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(angle), axis))
    place_on_build_plate(mesh)
    mesh.export(output_path)
    emit_result(build_result(mesh))


def _bool_arg(value):
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on")


def main(argv):
    parser = argparse.ArgumentParser(description="3D model preprocessing")
    sub = parser.add_subparsers(dest="mode", required=True)

    p = sub.add_parser("preprocess")
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--technology", default="FDM", choices=["FDM", "SLA", "fdm", "sla"])
    p.add_argument("--auto-orient", default="1")

    t = sub.add_parser("transform")
    t.add_argument("input")
    t.add_argument("output")
    t.add_argument("--scale", nargs=3, type=float, required=True, metavar=("SX", "SY", "SZ"))
    t.add_argument("--rotate", nargs=3, type=float, default=[0, 0, 0], metavar=("RX", "RY", "RZ"))

    args = parser.parse_args(argv)
    try:
        if args.mode == "preprocess":
            run_preprocess(args.input, args.output, args.technology.upper(), _bool_arg(args.auto_orient))
        else:
            run_transform(args.input, args.output, args.scale, args.rotate)
    except SourceGeometryError as exc:
        # 'mesh2stl.py' keeps errors.js converter detection working; hints match its list.
        print(f"[PYTHON mesh2stl.py/preprocess.py] ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print("[PYTHON preprocess.py] ERROR: Input mesh file was not found.", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"[PYTHON preprocess.py] ERROR: {args.mode} failed. {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
