"""Orientation optimizer for STL models.

Finds a stable orientation that minimizes print height and exports an
orientation-adjusted STL model.
"""

import sys
import trimesh

def optimize_orientation(input_path, output_path, technology='FDM'):
    """Optimize model orientation for printing.

    Args:
        input_path: Path to source STL file.
        output_path: Destination STL output path.
        technology: Printing technology label (FDM or SLA).

    Returns:
        None. Writes oriented STL output to disk.

    Raises:
        SystemExit: If optimization fails after fallback copy.
    """
    print(f"[PYTHON ORIENT] Analyzing orientation for {technology}: {input_path}")
    
    try:
        # 1. Load the mesh
        mesh = trimesh.load(input_path)
        
        if isinstance(mesh, trimesh.Scene):
            print("[PYTHON ORIENT] Merging scene into single mesh...")
            mesh = trimesh.util.concatenate(mesh.dump())

        # 2. Original dimensions
        original_height = mesh.extents[2]
        print(f"[PYTHON ORIENT] Original Z-Height: {original_height:.2f}mm")

        # 3. Compute stable poses
        try:
            poses, _ = mesh.compute_stable_poses(n_samples=5, threshold=0.02)
        except Exception as e:
            print(f"[PYTHON ORIENT] Warning: Could not compute stable poses ({e}). Keeping original.")
            poses = []

        best_pose = None
        min_score = float('inf')

        if len(poses) == 0:
            print("[PYTHON ORIENT] No stable poses found (maybe a sphere?). keeping original.")
            mesh.export(output_path)
            return

        print(f"[PYTHON ORIENT] Found {len(poses)} stable orientations. Evaluating...")

        # 4. Scoring each pose
        for i, tf in enumerate(poses):
            temp_mesh = mesh.copy()
            temp_mesh.apply_transform(tf)
            
            z_height = temp_mesh.extents[2]
            
            score = z_height 

            print(f" - Pose {i}: Z={z_height:.2f}mm")

            if score < min_score:
                min_score = score
                best_pose = tf

        # 5. Apply the best orientation
        if best_pose is not None:
            print(f"[PYTHON ORIENT] Applying optimal orientation (Z: {min_score:.2f}mm)")
            mesh.apply_transform(best_pose)
        
        # Centering the mesh on X and Y axes
        mesh.apply_translation(-mesh.centroid)
        
        # Ensure the lowest point is at Z=0
        min_z = mesh.bounds[0][2]
        mesh.apply_translation([0, 0, -min_z])
        
        # 6. Final export
        mesh.export(output_path)
        print(f"[PYTHON ORIENT] Success! Saved to {output_path}")

    except Exception as e:
        print(f"[PYTHON ORIENT] CRITICAL ERROR: {str(e)}")
        import shutil
        shutil.copy2(input_path, output_path)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 orient.py input.stl output.stl [FDM/SLA]")
        sys.exit(1)
    
    tech = "FDM"
    if len(sys.argv) > 3:
        tech = sys.argv[3]

    optimize_orientation(sys.argv[1], sys.argv[2], tech)