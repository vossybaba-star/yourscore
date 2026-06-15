"""Headless Blender: isolate one StudioOchi player, author penalty animation clips
on its rig, and export a multi-clip GLB the R3F scene plays per action.

Clips: idle, kick (taker) · ready, dive_L, dive_R, save_mid (keeper).
Bone-local euler degrees, relative to rest. Axis facts (this rig, player faces -Y):
  thigh  -X = leg forward, +X = back ; shin +X = bend knee
  spine.003 +X = lean forward ; spine (root) tips the whole body for dives
  upper_arm.L +Z = raise out to the side ; upper_arm.R -Z = raise out

Run: blender -b --python scripts/draft/blender/build_anim.py -- <glb> <out.glb> [contact_dir]
"""
import bpy, sys, math, os, mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
glb = argv[0] if len(argv) > 0 else "public/models/players.glb"
out = argv[1] if len(argv) > 1 else "public/models/penalty-player.glb"
contact = argv[2] if len(argv) > 2 else None
KEEP = "GLTF_created_0"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

# Keep one player.
kill = []
for o in bpy.data.objects:
    if o.name == KEEP:
        continue
    if o.type == "ARMATURE" or (o.type == "MESH" and o.name.startswith("Icosphere")):
        kill.append(o.name)
    elif o.parent and o.parent.type == "ARMATURE" and o.parent.name != KEEP:
        kill.append(o.name)
for name in kill:
    ob = bpy.data.objects.get(name)
    if ob:
        bpy.data.objects.remove(ob, do_unlink=True)

arm = bpy.data.objects[KEEP]
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)  # drop the original showcase clip

for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"

def base(n):
    return n.rsplit("_", 1)[0]

bonemap = {base(pb.name): pb for pb in arm.pose.bones}

# clips: name -> list of (frame, {bone: [x,y,z deg]})
D = math.radians
CLIPS = {
    "idle": [
        (1,  {}),
        (30, {"spine.003": [2, 0, 0], "upper_arm.L": [0, 0, 4], "upper_arm.R": [0, 0, -4]}),
        (60, {}),
    ],
    "kick": [
        # wind-up: kicking (R) leg back + knee cocked, lean back
        (1,  {"thigh.R": [-42, 0, 0], "shin.R": [55, 0, 0], "spine.003": [-8, 0, 0],
              "upper_arm.L": [0, 0, 22], "upper_arm.R": [0, 0, -14], "thigh.L": [8, 0, 0]}),
        # contact: leg drives FORWARD through the ball, lean in, arms out for balance
        (9,  {"thigh.R": [52, 0, 0], "shin.R": [16, 0, 0], "spine.003": [14, 0, 0],
              "upper_arm.L": [0, 0, 46], "upper_arm.R": [0, 0, -46], "thigh.L": [-10, 0, 0], "shin.L": [8, 0, 0]}),
        # follow-through: leg high, lean forward
        (16, {"thigh.R": [78, 0, 0], "shin.R": [30, 0, 0], "spine.003": [18, 0, 0],
              "upper_arm.L": [0, 0, 40], "upper_arm.R": [0, 0, -40], "thigh.L": [-6, 0, 0]}),
        (30, {"spine.003": [5, 0, 0]}),
    ],
    "ready": [
        (1,  {"thigh.L": [0, 0, 16], "thigh.R": [0, 0, -16], "shin.L": [10, 0, 0], "shin.R": [10, 0, 0],
              "upper_arm.L": [0, 0, 32], "upper_arm.R": [0, 0, -32], "forearm.L": [16, 0, 0], "forearm.R": [16, 0, 0]}),
        (24, {"thigh.L": [0, 0, 18], "thigh.R": [0, 0, -18], "shin.L": [16, 0, 0], "shin.R": [16, 0, 0],
              "spine.003": [4, 0, 0], "upper_arm.L": [0, 0, 35], "upper_arm.R": [0, 0, -35], "forearm.L": [16, 0, 0], "forearm.R": [16, 0, 0]}),
        (48, {"thigh.L": [0, 0, 16], "thigh.R": [0, 0, -16], "shin.L": [10, 0, 0], "shin.R": [10, 0, 0],
              "upper_arm.L": [0, 0, 32], "upper_arm.R": [0, 0, -32], "forearm.L": [16, 0, 0], "forearm.R": [16, 0, 0]}),
    ],
    # dive: tip the whole body sideways via the root spine (X axis = frontal tip),
    # reach both arms toward the dive side. The scene also slides the group sideways.
    "dive_R": [
        (1,  {"thigh.L": [0, 0, 16], "thigh.R": [0, 0, -16], "shin.L": [12, 0, 0], "shin.R": [12, 0, 0],
              "upper_arm.L": [0, 0, 30], "upper_arm.R": [0, 0, -30]}),
        (14, {"spine": [60, 0, 0], "upper_arm.L": [0, 0, 95], "upper_arm.R": [0, 0, -120],
              "thigh.R": [-12, 0, 0], "thigh.L": [10, 0, 0], "shin.R": [16, 0, 0]}),
    ],
    "dive_L": [
        (1,  {"thigh.L": [0, 0, 16], "thigh.R": [0, 0, -16], "shin.L": [12, 0, 0], "shin.R": [12, 0, 0],
              "upper_arm.L": [0, 0, 30], "upper_arm.R": [0, 0, -30]}),
        (14, {"spine": [-60, 0, 0], "upper_arm.R": [0, 0, -95], "upper_arm.L": [0, 0, 120],
              "thigh.L": [-12, 0, 0], "thigh.R": [10, 0, 0], "shin.L": [16, 0, 0]}),
    ],
    "save_mid": [
        (1,  {"thigh.L": [0, 0, 16], "thigh.R": [0, 0, -16], "shin.L": [12, 0, 0], "shin.R": [12, 0, 0],
              "upper_arm.L": [0, 0, 30], "upper_arm.R": [0, 0, -30]}),
        (10, {"upper_arm.L": [-95, 0, 25], "upper_arm.R": [-95, 0, -25], "forearm.L": [-35, 0, 0], "forearm.R": [-35, 0, 0],
              "spine.003": [10, 0, 0], "thigh.L": [0, 0, 12], "thigh.R": [0, 0, -12], "shin.L": [22, 0, 0], "shin.R": [22, 0, 0]}),
    ],
}

def reset_pose():
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)

for clip_name, frames in CLIPS.items():
    reset_pose()
    action = bpy.data.actions.new(clip_name)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    used = set()
    for _, d in frames:
        used |= set(d.keys())
    for frame, d in frames:
        bpy.context.scene.frame_set(frame)
        for bn in used:
            pb = bonemap.get(bn)
            if not pb:
                continue
            v = d.get(bn, [0, 0, 0])
            pb.rotation_euler = (D(v[0]), D(v[1]), D(v[2]))
            pb.keyframe_insert("rotation_euler", frame=frame)

# Stash all actions so the exporter emits each as its own glTF animation.
arm.animation_data.action = None

print("ACTIONS:", [a.name for a in bpy.data.actions])

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_nla_strips=False,
    export_apply=False,
    export_yup=True,
)
print("EXPORTED", out, "size", os.path.getsize(out))

# Optional contact sheet: render side view of each clip's last keyframe.
if contact:
    os.makedirs(contact, exist_ok=True)
    mesh = next(o for o in arm.children if o.type == "MESH")
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN")); bpy.context.scene.collection.objects.link(sun)
    sun.data.energy = 4.0; sun.rotation_euler = (D(55), 0, D(35))
    w = bpy.data.worlds.new("W"); w.use_nodes = True; w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    bpy.context.scene.world = w
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.film_transparent = True
    sc.render.resolution_x = 420; sc.render.resolution_y = 500
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 55
    cx, cy, cz = 2.99, -0.09, 0.85
    for clip_name, frames in CLIPS.items():
        arm.animation_data.action = bpy.data.actions[clip_name]
        bpy.context.scene.frame_set(frames[-1][0] if clip_name != "kick" else 9)
        cam.location = mathutils.Vector((cx + 4.2, cy, cz))
        cam.rotation_euler = (cam.location - mathutils.Vector((cx, cy, cz))).to_track_quat("Z", "Y").to_euler()
        sc.render.filepath = os.path.join(contact, f"clip_{clip_name}.png")
        bpy.ops.render.render(write_still=True)
        print("contact", clip_name)
    arm.animation_data.action = None
print("DONE")
