"""CAD-to-STL conversion utility.

Converts supported CAD interchange formats into STL meshes without applying
automatic geometry healing or shape correction to preserve source fidelity.
"""

import sys
import os
import shutil
import gmsh

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
        print(f"[PYTHON CAD] CRITICAL ERROR: File not found at {input_abs_path}")
        sys.exit(1)

    # 1. HTML check
    try:
        with open(input_abs_path, 'rb') as f:
            header = f.read(80)
            try:
                text_header = header.decode('ascii')
                if "<!DOCTYPE html" in text_header or "<html" in text_header:
                    print("[PYTHON CAD] CRITICAL ERROR: The file header contains HTML tags.")
                    raise ValueError("Invalid file format! You uploaded a downloaded WEBPAGE (HTML), not a CAD file.")
            except UnicodeDecodeError:
                pass
    except Exception:
        pass

    # 2. File extension handling
    temp_igs_path = input_abs_path
    if input_abs_path.lower().endswith('.iges'):
        temp_igs_path = input_abs_path.replace('.iges', '.igs')
        shutil.copy2(input_abs_path, temp_igs_path)

    try:
        gmsh.initialize()
        gmsh.option.setNumber("General.Terminal", 1)
        gmsh.option.setNumber("General.Verbosity", 2)

        # 3. Loading and merging
        print("[PYTHON CAD] Merging file...")
        gmsh.merge(temp_igs_path)

        # 4. Synchronize imported geometry
        gmsh.model.occ.synchronize()

        # 5. Exporting to STL
        gmsh.option.setNumber("Mesh.MeshSizeMin", 0.5)
        gmsh.option.setNumber("Mesh.MeshSizeMax", 5.0)

        gmsh.model.mesh.generate(2)
        
        # 6. Save
        gmsh.write(output_abs_path)
        gmsh.finalize()
        print(f"[PYTHON CAD] Success! Exported to {output_abs_path}")

    except Exception as e:
        print(f"[PYTHON CAD] CRITICAL ERROR: {str(e)}")
        if gmsh.isInitialized(): gmsh.finalize()
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 cad2stl.py input.(iges|igs|step|stp) output.stl")
        sys.exit(1)
        
    convert_cad_to_stl(sys.argv[1], sys.argv[2])