import sys
import os
import numpy as np
from PIL import Image
import trimesh

def image_to_stl(input_path, output_path, depth_mm=3.0, base_mm=0.5):
    print(f"[PYTHON IMG] Processing image: {input_path}")
    
    try:
        # 1. Load Image and Convert to Grayscale
        img = Image.open(input_path).convert('L') 
        
        # 2. Resize if too large (Optimization)
        # Large images generate millions of triangles, slowing down slicing significantly.
        max_dim = 300 # Limit width/height to 300px
        if img.width > max_dim or img.height > max_dim:
            img.thumbnail((max_dim, max_dim))
            print(f"[PYTHON IMG] Resized image to {img.width}x{img.height} for performance.")
        
        # 3. Process Pixel Data
        img_array = np.array(img)
        height, width = img_array.shape
        
        # Calculate pixel size to achieve a reasonable physical width (e.g., 100mm wide)
        target_width_mm = 100.0
        pixel_size_mm = target_width_mm / width
        
        print(f"[PYTHON IMG] Physical dimensions will be approx: {target_width_mm:.2f}mm width.")

        # 4. Generate Vertex Grid
        # Create a grid of X, Y coordinates
        x = np.arange(0, width) * pixel_size_mm
        y = np.arange(0, height) * pixel_size_mm
        X, Y = np.meshgrid(x, y[::-1]) # Flip Y so image isn't upside down
        
        # Calculate Z height based on brightness
        # Invert: Dark = Thick (Base + Depth), Light = Thin (Base)
        # 255 (White) -> 0 depth, 0 (Black) -> max depth
        z_data = (255 - img_array) / 255.0 
        Z = base_mm + (z_data * depth_mm)
        
        # Flatten arrays to create vertex list
        vertices = np.column_stack((X.flatten(), Y.flatten(), Z.flatten()))
        
        # 5. Generate Faces (Triangulation)
        # We need to connect the grid points into triangles.
        # Two triangles per pixel square.
        faces = []
        for r in range(height - 1):
            for c in range(width - 1):
                # Calculate indices in the flattened vertex array
                tl = r * width + c       # Top-Left
                tr = r * width + (c + 1) # Top-Right
                bl = (r + 1) * width + c # Bottom-Left
                br = (r + 1) * width + (c + 1) # Bottom-Right
                
                # Triangle 1
                faces.append([bl, tr, tl])
                # Triangle 2
                faces.append([bl, br, tr])
                
        faces = np.array(faces)
        
        # 6. Create Mesh using Trimesh
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        
        # 7. Post-Processing
        # Fix normals (ensures outside is outside)
        mesh.fix_normals()
        
        # Center the mesh and put it on the floor (Z=0)
        mesh.apply_translation(-mesh.centroid)
        min_z = mesh.bounds[0][2]
        mesh.apply_translation([0, 0, -min_z])

        # 8. Export
        print(f"[PYTHON IMG] Saving STL to {output_path}")
        mesh.export(output_path)
        print("[PYTHON IMG] Success.")

    except Exception as e:
        print(f"[PYTHON IMG] CRITICAL ERROR: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 img2stl.py input.(jpg|jpeg|png|bmp) output.stl")
        sys.exit(1)
        
    depth = 3.0
    if len(sys.argv) > 3:
        try:
            depth = float(sys.argv[3])
        except:
            pass
            
    image_to_stl(sys.argv[1], sys.argv[2], depth)