import sys
import os
import shutil
import gmsh

def convert_cad_to_stl(input_path, output_path):
    input_abs_path = os.path.abspath(input_path)
    output_abs_path = os.path.abspath(output_path)
    
    print(f"[PYTHON CAD] Processing: {input_abs_path}")

    # 1. File existence and size check
    if not os.path.exists(input_abs_path):
        print(f"[PYTHON CAD] CRITICAL ERROR: File not found at {input_abs_path}")
        sys.exit(1)

    file_size = os.path.getsize(input_abs_path)
    print(f"[PYTHON CAD] File size: {file_size} bytes")
    
    if file_size < 100:
        print("[PYTHON CAD] ERROR: File is too small/empty.")
        sys.exit(1)

    # 2. File header check (HTML vs CAD)
    try:
        with open(input_abs_path, 'rb') as f:
            header = f.read(80) 
            print(f"[PYTHON CAD] Header Check (Hex): {header.hex()[:40]}...") 
            try:
                text_header = header.decode('ascii')
                print(f"[PYTHON CAD] Header Check (Text): '{text_header.strip()}'")
                
                if "<!DOCTYPE html" in text_header or "<html" in text_header:
                    print("[PYTHON CAD] CRITICAL ERROR: The file header contains HTML tags.")
                    raise ValueError("Invalid file format! You uploaded a downloaded WEBPAGE (HTML), not a CAD file. Please re-download the file correctly.")

            except UnicodeDecodeError:
                print(f"[PYTHON CAD] WARNING: Header is binary (valid for some CAD formats).")
    except Exception as e:
        print(f"[PYTHON CAD] Error analyzing header: {e}")
        sys.exit(1)

    # 3. File extension handling and temporary renaming if needed
    temp_igs_path = input_abs_path
    if input_abs_path.lower().endswith('.iges'):
        temp_igs_path = input_abs_path.replace('.iges', '.igs')
        print(f"[PYTHON CAD] Renaming .iges to .igs for compatibility: {temp_igs_path}")
        shutil.copy2(input_abs_path, temp_igs_path)

    try:
        gmsh.initialize()
        gmsh.option.setNumber("General.Terminal", 1) 
        gmsh.option.setNumber("General.Verbosity", 2)

        # 4. Loading the CAD file
        print(f"[PYTHON CAD] Attempting to merge: {temp_igs_path}")
        gmsh.merge(temp_igs_path)
        
        # 5. Geometry check and synchronization
        gmsh.model.occ.synchronize()
        entities = gmsh.model.getEntities()
        print(f"[PYTHON CAD] Loaded entities: {len(entities)}")

        if len(entities) == 0:
            print("[PYTHON CAD] Merge yielded 0 entities. Trying explicit OCC Import...")
            gmsh.model.occ.importShapes(temp_igs_path)
            gmsh.model.occ.synchronize()
            entities = gmsh.model.getEntities()
        
        if len(entities) == 0:
             raise ValueError("File contains no recognizable geometry (0 entities).")

        # 6. Bounding box and auto-scaling
        bbox = gmsh.model.getBoundingBox(-1, -1)
        if not bbox: raise ValueError("Empty bounding box.")
        
        dx = bbox[3] - bbox[0]
        dy = bbox[4] - bbox[1]
        dz = bbox[5] - bbox[2]
        max_dim = max(dx, dy, dz)
        print(f"[PYTHON CAD] Dimensions: {dx:.2f} x {dy:.2f} x {dz:.2f} (Max: {max_dim:.2f})")

        if max_dim < 5.0 and max_dim > 0.001:
            print("[PYTHON CAD] Scaling x1000...")
            gmsh.model.occ.dilate(entities, 0, 0, 0, 1000, 1000, 1000)
            gmsh.model.occ.synchronize()

        # 7. Export
        gmsh.option.setNumber("Mesh.MeshSizeMin", 0.5)
        gmsh.option.setNumber("Mesh.MeshSizeMax", 5.0)
        gmsh.model.mesh.generate(2)
        gmsh.write(output_abs_path)
        
        gmsh.finalize()
        print(f"[PYTHON CAD] Success! Exported to {output_abs_path}")
        
        # 8. Cleanup temporary file if it was created
        if temp_igs_path != input_abs_path and os.path.exists(temp_igs_path):
            os.remove(temp_igs_path)

    except Exception as e:
        print(f"[PYTHON CAD] CRITICAL ERROR: {str(e)}")
        if gmsh.isInitialized(): gmsh.finalize()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    convert_cad_to_stl(sys.argv[1], sys.argv[2])