"""Headless Blender: inspect the players GLB — objects, armatures, bones, animations.
Run: blender --background --python scripts/draft/blender/inspect.py -- public/models/players.glb
"""
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
glb = argv[0] if argv else "public/models/players.glb"

# clean default scene
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

print("\n==== OBJECTS ====")
for o in bpy.data.objects:
    print(f"- {o.type:10s} '{o.name}'  parent={o.parent.name if o.parent else None}")

print("\n==== ARMATURES (bones) ====")
for a in bpy.data.armatures:
    bones = [b.name for b in a.bones]
    print(f"- armature '{a.name}'  bones={len(bones)}")
    print("   ", ", ".join(bones))
    break  # one is enough; the 6 share a layout

print("\n==== ACTIONS / ANIMATIONS ====")
for act in bpy.data.actions:
    print(f"- action '{act.name}'  frames={act.frame_range[:]}")

print("\n==== MATERIALS ====")
for m in bpy.data.materials:
    print(f"- '{m.name}'")

print("\n==== MESHES ====")
for o in bpy.data.objects:
    if o.type == "MESH":
        mats = [s.material.name if s.material else None for s in o.material_slots]
        print(f"- mesh '{o.name}'  verts={len(o.data.vertices)}  mats={mats}")

print("\nDONE")
