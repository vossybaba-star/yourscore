"""Headless Blender: isolate one player, apply a pose, render front+side PNGs so we
can learn the rig's bone axes / framing before authoring animation clips.

Run: blender -b --python scripts/draft/blender/render_pose.py -- <glb> <out_dir> <pose_json>
pose_json: {"thigh.R": [deg_x, deg_y, deg_z], ...}  (base bone names; suffix auto-matched)
"""
import bpy, sys, json, math, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
glb = argv[0] if len(argv) > 0 else "public/models/players.glb"
out = argv[1] if len(argv) > 1 else "/tmp/blender"
pose = json.loads(argv[2]) if len(argv) > 2 else {}
KEEP = "GLTF_created_0"  # player A (Soccer Man A)

os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

# Delete every armature except KEEP, plus their children and stray icospheres.
# Collect names first (removing during iteration invalidates the RNA refs).
keep_arm = bpy.data.objects.get(KEEP)
kill = []
for o in bpy.data.objects:
    if o.name == KEEP:
        continue
    if o.type == "ARMATURE":
        kill.append(o.name)
    elif o.type == "MESH" and o.name.startswith("Icosphere"):
        kill.append(o.name)
    elif o.parent and o.parent.type == "ARMATURE" and o.parent.name != KEEP:
        kill.append(o.name)
for name in kill:
    ob = bpy.data.objects.get(name)
    if ob:
        bpy.data.objects.remove(ob, do_unlink=True)

# Apply pose (rotation relative to rest, in bone-local XYZ euler).
def base(n): return n.rsplit("_", 1)[0]
arm = keep_arm
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
    d = pose.get(base(pb.name))
    if d:
        pb.rotation_euler = (math.radians(d[0]), math.radians(d[1]), math.radians(d[2]))

# World bounds of the kept mesh for framing.
import mathutils
mesh = next(o for o in arm.children if o.type == "MESH")
bpy.context.view_layer.update()
coords = [mesh.matrix_world @ mathutils.Vector(c) for c in mesh.bound_box]
zs = [c.z for c in coords]; xs = [c.x for c in coords]; ys = [c.y for c in coords]
cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; cz = (min(zs) + max(zs)) / 2
height = max(zs) - min(zs)
print(f"BOUNDS center=({cx:.2f},{cy:.2f},{cz:.2f}) height={height:.2f} z=[{min(zs):.2f},{max(zs):.2f}]")

# Lighting
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN")); bpy.context.scene.collection.objects.link(sun)
sun.data.energy = 4.0; sun.rotation_euler = (math.radians(55), 0, math.radians(35))
bpy.context.scene.world = bpy.data.worlds.new("W")
bpy.context.scene.world.use_nodes = True
bpy.context.scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

# Render settings — Eevee, transparent
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.film_transparent = True
scene.render.resolution_x = 600; scene.render.resolution_y = 700
scene.render.image_settings.file_format = "PNG"

cam_data = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.scene.collection.objects.link(cam); scene.camera = cam
cam_data.lens = 60

def look_at(obj, target):
    d = (obj.location - target)
    obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()

target = mathutils.Vector((cx, cy, cz))
dist = height * 2.2
views = {
    "front_Yneg": mathutils.Vector((cx, cy - dist, cz)),
    "front_Ypos": mathutils.Vector((cx, cy + dist, cz)),
    "side_Xpos": mathutils.Vector((cx + dist, cy, cz)),
}
for name, pos in views.items():
    cam.location = pos; look_at(cam, target)
    scene.render.filepath = os.path.join(out, f"pose_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", scene.render.filepath)
print("DONE")
