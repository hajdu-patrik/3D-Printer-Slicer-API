import sys
import os
import shutil
import gmsh
import math

def convert_cad_to_stl(input_path, output_path):
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
            except:
                pass
    except Exception as e:
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

        gmsh.option.setNumber("Geometry.Tolerance", 1e-3) 
        gmsh.option.setNumber("Geometry.OCCFixSmallEdges", 1)
        gmsh.option.setNumber("Geometry.OCCFixSmallFaces", 1)
        gmsh.option.setNumber("Geometry.OCCSewFaces", 1)

        # 3. Loading and merging
        print(f"[PYTHON CAD] Merging file...")
        gmsh.merge(temp_igs_path)
        
        # 4. Healing
        print("[PYTHON CAD] Healing geometry...")
        entities = gmsh.model.getEntities()
        try:
            gmsh.model.occ.healShapes(entities, tolerance=1e-3)
        except:
            pass
            
        gmsh.model.occ.synchronize()

        # 5. Scaling check
        bbox = gmsh.model.getBoundingBox(-1, -1)
        if len(bbox) > 0:
            dx = bbox[3] - bbox[0]
            dy = bbox[4] - bbox[1]
            dz = bbox[5] - bbox[2]
            max_dim = max(dx, dy, dz)
            print(f"[PYTHON CAD] Dimensions: {dx:.2f} x {dy:.2f} x {dz:.2f}")

            if max_dim < 5.0 and max_dim > 0.001:
                print("[PYTHON CAD] Scaling x1000...")
                gmsh.model.occ.dilate(entities, 0, 0, 0, 1000, 1000, 1000)
                gmsh.model.occ.synchronize()

        # 6. Exporting to STL
        gmsh.option.setNumber("Mesh.MeshSizeMin", 0.5)
        gmsh.option.setNumber("Mesh.MeshSizeMax", 5.0)

        try:
            gmsh.model.mesh.generate(2)
        except Exception as e:
            print(f"[PYTHON CAD] Mesh generation failed ({str(e)}). Trying direct STL export...")
        
        # 7. Save
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