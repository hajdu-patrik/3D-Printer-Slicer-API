import sys
import trimesh
import numpy as np

# Mesh->STL converter method
def convert_mesh_to_stl(input_path, output_path):
    print(f"[PYTHON] Loading mesh: {input_path}")
    try:
        # 1. Loading the mesh
        mesh = trimesh.load(input_path)

        # 2. Scene handling
        if isinstance(mesh, trimesh.Scene):
            print("[PYTHON] Input is a Scene, merging geometries...")

            if len(mesh.geometry) == 0:
                raise ValueError("Scene is empty!")

            mesh = trimesh.util.concatenate(mesh.dump())

        # 3. Exporting to STL
        mesh.export(output_path)
        print(f"[PYTHON] Success! Exported to {output_path}")

    except Exception as e:
        print(f"[PYTHON] Error converting mesh: {e}")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 mesh2stl.py input.(obj|3mf) output.stl")
        sys.exit(1)

    convert_mesh_to_stl(sys.argv[1], sys.argv[2])