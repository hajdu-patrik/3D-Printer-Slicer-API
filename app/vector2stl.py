import sys
import os
import trimesh
import numpy as np
import subprocess
from shapely.geometry import Polygon, MultiPolygon, LineString, LinearRing
from shapely.ops import unary_union, polygonize
from shapely.validation import make_valid

def vector_to_stl(input_path, output_path, depth_mm=2.0):
    print(f"[PYTHON VECTOR] Processing: {input_path}")
    
    processing_path = input_path
    temp_dxf = None

    try:
        # 1. EPS ando PDF handling
        if input_path.lower().endswith(('.eps', '.pdf')):
            print(f"[PYTHON VECTOR] {os.path.splitext(input_path)[1]} detected. Converting to DXF using pstoedit...")
            temp_dxf = input_path + ".converted.dxf"
            
            cmd = ["pstoedit", "-dt", "-f", "dxf:-polyaslines", input_path, temp_dxf]
            
            result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            if result.returncode != 0:
                print(f"[PYTHON VECTOR] pstoedit warning: {result.stderr}")
            
            if os.path.exists(temp_dxf):
                processing_path = temp_dxf
            else:
                raise ValueError("Conversion failed. DXF file was not created.")

        # 2. Loading
        try:
            scene = trimesh.load(processing_path, force='path')
        except Exception as e:
            raise ValueError(f"Failed to load path geometry: {str(e)}")

        if isinstance(scene, trimesh.Scene):
            geometries = [g for g in scene.geometry.values() if isinstance(g, trimesh.path.Path2D)]
        elif isinstance(scene, trimesh.path.Path2D):
            geometries = [scene]
        else:
            geometries = []

        if not geometries:
            raise ValueError("No 2D geometry found in file.")

        print(f"[PYTHON VECTOR] Found {len(geometries)} geometry layers. Processing...")

        # 3. Geometry Processing
        extruded_meshes = []

        for path in geometries:
            polygons = []
            
            try:
                polygons = list(path.polygons_full)
                if not polygons:
                    polygons = list(path.polygons_closed)
            except:
                pass

            if not polygons:
                lines = []
                for entity in path.entities:
                    pts = entity.discrete(path.vertices)
                    if len(pts) > 1:
                        lines.append(LineString(pts))
                
                try:
                    polygons = list(polygonize(lines))
                except:
                    pass

                if not polygons and lines:
                    print(f"[PYTHON VECTOR] No closed shapes found. Thickening {len(lines)} open lines...")
                    line_thickness = 0.8 
                    for line in lines:
                        thick_line = line.buffer(line_thickness / 2, cap_style=1, join_style=1)
                        polygons.append(thick_line)

            for poly in polygons:
                try:
                    if not poly.is_valid:
                        poly = make_valid(poly)
                    
                    clean_poly = poly.buffer(0)
                    if clean_poly.is_empty: continue

                    if isinstance(clean_poly, MultiPolygon):
                        sub_polys = clean_poly.geoms
                    else:
                        sub_polys = [clean_poly]

                    for p in sub_polys:
                        mesh = trimesh.creation.extrude_polygon(p, height=depth_mm)
                        if not mesh.is_empty:
                            extruded_meshes.append(mesh)

                except Exception as ex:
                    continue

        if not extruded_meshes:
            raise ValueError("Could not create ANY geometry. File is likely empty or unreadable.")

        # 4. Merging
        combined_mesh = trimesh.util.concatenate(extruded_meshes)

        # 5. Scaling
        bbox = combined_mesh.bounds
        size = bbox[1] - bbox[0]
        max_dim = np.max(size)
        
        print(f"[PYTHON VECTOR] Raw Size: {size[0]:.2f} x {size[1]:.2f} mm")

        if max_dim < 15.0:
            target = 100.0
            scale = target / max_dim
            print(f"[PYTHON VECTOR] Scaling up x{scale:.2f}")
            combined_mesh.apply_scale(scale)
        elif max_dim < 50.0:
            combined_mesh.apply_scale(25.4)

        # 6. Positioning
        combined_mesh.apply_translation(-combined_mesh.centroid)
        min_z = combined_mesh.bounds[0][2]
        combined_mesh.apply_translation([0, 0, -min_z])

        # 7. Save
        combined_mesh.export(output_path)
        print(f"[PYTHON VECTOR] Success! Exported to {output_path}")

    except Exception as e:
        print(f"[PYTHON VECTOR] CRITICAL ERROR: {str(e)}")
        sys.exit(1)
        
    finally:
        if temp_dxf and os.path.exists(temp_dxf):
            try: os.remove(temp_dxf)
            except: pass


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 vector2stl.py input.(dxf|svg|eps|pdf) output.stl")
        sys.exit(1)
    
    depth = 2.0
    if len(sys.argv) > 3:
        try: depth = float(sys.argv[3])
        except: pass
            
    vector_to_stl(sys.argv[1], sys.argv[2], depth)