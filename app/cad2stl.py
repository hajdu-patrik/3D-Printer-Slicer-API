"""CAD-to-STL conversion utility.

Converts supported CAD interchange formats into STL meshes without applying
automatic geometry healing or shape correction to preserve source fidelity.
"""

import sys
import os
import shutil
import gmsh


class UserFileError(ValueError):
    """Raised when the uploaded CAD file is invalid."""


def _check_not_html(path):
    """Reject files that are actually downloaded HTML pages."""
    with open(path, 'rb') as file_obj:
        header = file_obj.read(256)

    try:
        text_header = header.decode('ascii', errors='ignore').lower()
    except Exception:
        return

    if "<!doctype html" in text_header or "<html" in text_header:
        raise UserFileError(
            "The uploaded file is not a valid CAD file. Please upload the original CAD export file."
        )

# Tessellation quality: curvature-adaptive sizing relative to the part size.
ELEMENTS_PER_FULL_CIRCLE = 24      # Mesh.MeshSizeFromCurvature: elements per 2*pi of curvature
MAX_SIZE_DIAGONAL_DIVISOR = 20.0   # MeshSizeMax = bounding-box diagonal / 20
MIN_SIZE_DIAGONAL_DIVISOR = 2000.0  # MeshSizeMin = bounding-box diagonal / 2000


def _disable_geometry_healing():
    """Keep gmsh OCC import free of any automatic shape healing (source fidelity)."""
    for option in (
        "Geometry.OCCFixDegenerated",
        "Geometry.OCCFixSmallEdges",
        "Geometry.OCCFixSmallFaces",
        "Geometry.OCCSewFaces",
        "Geometry.OCCMakeSolids",
    ):
        gmsh.option.setNumber(option, 0)


def _apply_adaptive_mesh_sizes():
    """Set mesh sizes from the model bounding box and surface curvature."""
    min_x, min_y, min_z, max_x, max_y, max_z = gmsh.model.getBoundingBox(-1, -1)
    diagonal = ((max_x - min_x) ** 2 + (max_y - min_y) ** 2 + (max_z - min_z) ** 2) ** 0.5
    if diagonal <= 0:
        raise ValueError("The CAD model has an empty bounding box.")

    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", ELEMENTS_PER_FULL_CIRCLE)
    gmsh.option.setNumber("Mesh.MeshSizeMax", diagonal / MAX_SIZE_DIAGONAL_DIVISOR)
    gmsh.option.setNumber("Mesh.MeshSizeMin", diagonal / MIN_SIZE_DIAGONAL_DIVISOR)
    # Size comes from curvature and bounding box only, not from point/boundary sizes.
    gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 0)
    gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 1)


def convert_cad_to_stl(input_path, output_path):
    """Convert a CAD file to STL format.

    Args:
        input_path: Path to the source CAD file (.iges, .igs, .step, .stp).
        output_path: Destination STL output path.

    Returns:
        None. Writes STL output to disk.

    Raises:
        SystemExit: If conversion fails or source file is invalid.
    """
    input_abs_path = os.path.abspath(input_path)
    output_abs_path = os.path.abspath(output_path)
    
    print(f"[PYTHON CAD] Processing: {input_abs_path}")

    if not os.path.exists(input_abs_path):
        print("[PYTHON CAD] ERROR: Input CAD file was not found.")
        sys.exit(1)

    # 1. HTML check
    try:
        _check_not_html(input_abs_path)
    except UserFileError as e:
        print(f"[PYTHON CAD] ERROR: {e}")
        sys.exit(1)

    # 2. File extension handling
    temp_igs_path = input_abs_path
    created_temp_copy = False
    if input_abs_path.lower().endswith('.iges'):
        temp_igs_path = os.path.splitext(input_abs_path)[0] + '.igs'
        shutil.copy2(input_abs_path, temp_igs_path)
        created_temp_copy = True

    try:
        gmsh.initialize()
        gmsh.option.setNumber("General.Terminal", 1)
        gmsh.option.setNumber("General.Verbosity", 2)

        _disable_geometry_healing()

        # 3. Loading and merging
        print("[PYTHON CAD] Merging file...")
        gmsh.merge(temp_igs_path)

        # 4. Synchronize imported geometry
        gmsh.model.occ.synchronize()

        # 5. Exporting to STL
        _apply_adaptive_mesh_sizes()

        gmsh.model.mesh.generate(2)
        
        # 6. Save
        gmsh.write(output_abs_path)
        print(f"[PYTHON CAD] Success! Exported to {output_abs_path}")

    except UserFileError as e:
        print(f"[PYTHON CAD] ERROR: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[PYTHON CAD] ERROR: Could not convert this CAD file. {str(e)}")
        sys.exit(1)
    finally:
        if gmsh.isInitialized():
            gmsh.finalize()
        if created_temp_copy and os.path.exists(temp_igs_path):
            try:
                os.remove(temp_igs_path)
            except OSError:
                pass


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 cad2stl.py input.(iges|igs|step|stp) output.stl")
        sys.exit(1)
        
    convert_cad_to_stl(sys.argv[1], sys.argv[2])