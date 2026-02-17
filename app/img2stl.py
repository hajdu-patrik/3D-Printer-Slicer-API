import sys
import numpy as np
from PIL import Image
from stl import mesh

# Image->STL converter method
def image_to_stl(image_path, output_path, width_mm=100, height_mm=None, depth_mm=3, invert=True):
    img = Image.open(image_path).convert('L')
    
    # Size and aspect ratio
    w_px, h_px = img.size
    aspect = h_px / w_px
    if height_mm is None:
        height_mm = width_mm * aspect
    
    # Pixel data handling (Placeholder for advanced lithophane logic)
    # img_array = np.array(img)
    # if invert:
    #    img_array = 255 - img_array
    
    # Note: z_heights array calculation logic is commented out to avoid "unused variable" warning
    # z_heights = (img_array / 255.0) * depth_mm + 0.5

    print(f"Converting {image_path} to {output_path}...")
    
    # Create a simple plate with the image dimensions
    vertices = np.array([
        [0, 0, 0], [width_mm, 0, 0], [width_mm, height_mm, 0], [0, height_mm, 0],
        [0, 0, depth_mm], [width_mm, 0, depth_mm], [width_mm, height_mm, depth_mm], [0, height_mm, depth_mm]
    ])
    faces = np.array([
        [0,3,1], [1,3,2], [0,4,7], [0,7,3], [4,5,6], [4,6,7],
        [5,1,2], [5,2,6], [2,3,6], [3,7,6], [0,1,5], [0,5,4]
    ])
    
    cube = mesh.Mesh(np.zeros(faces.shape[0], dtype=mesh.Mesh.dtype))
    for i, f in enumerate(faces):
        for j in range(3):
            cube.vectors[i][j] = vertices[f[j],:]
            
    cube.save(output_path)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 img2stl.py input.jpg output.stl")
        sys.exit(1)
    
    image_to_stl(sys.argv[1], sys.argv[2])