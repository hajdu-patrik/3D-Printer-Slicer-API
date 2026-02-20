"""Vector-to-STL converter.

Converts closed 2D vector geometry into extruded STL meshes while preserving
source fidelity by rejecting invalid or open geometry.
"""

import sys
import os
import trimesh
import subprocess
from shapely.geometry import MultiPolygon

def vector_to_stl(input_path, output_path, depth_mm=2.0):
    """Convert vector geometry to STL by linear extrusion.

    Args:
        input_path: Path to input vector file (.dxf, .svg, .eps, .pdf).
        output_path: Destination STL output path.
        depth_mm: Extrusion depth in millimeters.

    Returns:
        None. Writes STL output to disk.

    Raises:
        SystemExit: If input geometry is invalid or conversion fails.
    """
    print(f"[PYTHON VECTOR] Processing: {input_path}")
    
    processing_path = input_path
    temp_dxf = None

    try:
        # 1. EPS and PDF handling
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
            except Exception:
                pass

            if not polygons:
                raise ValueError("No closed 2D geometry found. Open paths/lines are not auto-fixed.")

            for poly in polygons:
                try:
                    if poly.is_empty:
                        continue

                    if not poly.is_valid:
                        raise ValueError("Invalid polygon geometry found. Auto-repair is disabled.")

                    if isinstance(poly, MultiPolygon):
                        sub_polys = poly.geoms
                    else:
                        sub_polys = [poly]

                    for p in sub_polys:
                        if p.is_empty:
                            continue
                        if not p.is_valid:
                            raise ValueError("Invalid polygon geometry found. Auto-repair is disabled.")
                        mesh = trimesh.creation.extrude_polygon(p, height=depth_mm)
                        if not mesh.is_empty:
                            extruded_meshes.append(mesh)

                except Exception as ex:
                    raise ValueError(f"Failed to extrude vector geometry without modifications: {str(ex)}")

        if not extruded_meshes:
            raise ValueError("Could not create ANY geometry. File is likely empty or unreadable.")

        # 4. Merging
        combined_mesh = trimesh.util.concatenate(extruded_meshes)

        # 5. Positioning
        combined_mesh.apply_translation(-combined_mesh.centroid)
        min_z = combined_mesh.bounds[0][2]
        combined_mesh.apply_translation([0, 0, -min_z])

        # 6. Save
        combined_mesh.export(output_path)
        print(f"[PYTHON VECTOR] Success! Exported to {output_path}")

    except Exception as e:
        print(f"[PYTHON VECTOR] CRITICAL ERROR: {str(e)}")
        sys.exit(1)
        
    finally:
        if temp_dxf and os.path.exists(temp_dxf):
            try:
                os.remove(temp_dxf)
            except OSError:
                pass


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 vector2stl.py input.(dxf|svg|eps|pdf) output.stl")
        sys.exit(1)
    
    depth = 2.0
    if len(sys.argv) > 3:
        try:
            depth = float(sys.argv[3])
        except ValueError:
            pass
            
    vector_to_stl(sys.argv[1], sys.argv[2], depth)