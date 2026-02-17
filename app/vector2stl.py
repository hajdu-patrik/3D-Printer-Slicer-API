import sys
import trimesh
# numpy is imported by trimesh, explicit import optional but kept for clarity
import numpy as np 

def vector_to_stl(input_path, output_path, thickness=2.0):
    print(f"Processing vector file: {input_path}")
    
    try:
        # 1. Load path
        flat_geometry = trimesh.load_path(input_path)
        
        # 2. Check if empty
        if flat_geometry.is_empty:
            raise ValueError("File is empty or contains no processable vectors.")

        # 3. Extrude
        mesh = flat_geometry.extrude(amount=thickness)

        # 4. Concatenate if multiple bodies
        if isinstance(mesh, list):
            mesh = trimesh.util.concatenate(mesh)

        # 5. Export
        mesh.export(output_path)
        print(f"Successfully converted to {output_path}")

    except Exception as e:
        print(f"Error converting vector: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 vector2stl.py input.dxf output.stl [thickness_mm]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    
    # Default thickness
    thickness_val = 2.0
    if len(sys.argv) > 3:
        try:
            thickness_val = float(sys.argv[3])
        except ValueError:
            pass # Keep default
            
    vector_to_stl(input_file, output_file, thickness_val)