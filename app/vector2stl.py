import sys
import os
import trimesh
import numpy as np

def vector_to_stl(input_path, output_path, thickness=2.0):
    print(f"[PYTHON VECTOR] Processing file: {input_path}")
    
    try:
        # 1. Loading the vector file
        path = trimesh.load_path(input_path)
        
        if path.is_empty:
            raise ValueError("File is empty or contains no readable vector data.")

        print(f"[PYTHON VECTOR] Loaded {len(path.entities)} entities.")

        # 2. Auto-scaling check
        bounds = path.bounds
        if bounds is None:
             raise ValueError("No bounds detected. Geometry might be invalid.")
             
        size = bounds[1] - bounds[0]
        max_dimension = np.max(size)
        print(f"[PYTHON VECTOR] Original max dimension: {max_dimension:.4f} units")

        scale_factor = 1.0
        if max_dimension < 5.0:
            print("[PYTHON VECTOR] Object too small! Applying auto-scaling (x25.4 for inch->mm or fix).")
            scale_factor = 25.4 # Inch to mm feltételezés, vagy csak nagyítás
            path.apply_transform(trimesh.transformations.scale_matrix(scale_factor))

        # 3. Extracting (2D -> 3D)
        mesh = path.extrude(amount=thickness)

        # 4. Result check and fix
        if isinstance(mesh, list):
            print(f"[PYTHON VECTOR] Extrusion created {len(mesh)} parts. Merging...")
            mesh = trimesh.util.concatenate(mesh)

        if mesh.is_empty:
             raise ValueError("Extrusion failed. Possible cause: Vector paths are not closed loops (circles/rectangles). Only closed shapes can be extruded.")

        # 5. Fix
        mesh.fix_normals()
        
        print(f"[PYTHON VECTOR] Exporting mesh with {len(mesh.faces)} faces to {output_path}")
        mesh.export(output_path)

    except Exception as e:
        print(f"[PYTHON VECTOR] CRITICAL ERROR: {str(e)}")
        create_fallback_cube(output_path)

def create_fallback_cube(output_path):
    print("[PYTHON VECTOR] Creating fallback ERROR CUBE to prevent crash.")
    mesh = trimesh.creation.box(extents=[10, 10, 2])
    mesh.export(output_path)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 vector2stl.py input.dxf output.stl [thickness_mm]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]

    thick = 2.0
    if len(sys.argv) > 3:
        try:
            thick = float(sys.argv[3])
        except ValueError:
            pass
            
    vector_to_stl(input_file, output_file, thickness=thick)