"""Build the final stylized penalty scene in Blender and render everything the
in-app 2D compositor needs, all from ONE fixed hero camera so the layers align:
  - bg.png        : stadium + pitch + goal + net (no players), opaque
  - taker_idle/kick.png : taker (foreground, rear view), transparent
  - keeper_ready/dive_l/dive_r/catch.png : keeper (in goal, front view), transparent
Run: bl.py code scripts/draft/blender/build_assets.py
Outputs -> public/sprites/pens/"""
import bpy, math, mathutils, os

OUT = os.path.abspath("public/sprites/pens"); os.makedirs(OUT, exist_ok=True)
GW, GH, GZ, R = 7.32, 2.44, -9.0, 0.08

# ---------- wipe ----------
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
for m in list(bpy.data.materials): bpy.data.materials.remove(m)

def mat(name, base, rough=0.7, metal=0.0, emit=None, es=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit: b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = es
    return m

# ---------- pitch (mowed stripes) ----------
bpy.ops.mesh.primitive_plane_add(size=90, location=(0, 0, 0)); pitch = bpy.context.object; pitch.name = "Pitch"
pm = bpy.data.materials.new("Pitch"); pm.use_nodes = True; nt = pm.node_tree; bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.9
co = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (0.16, 0.16, 0.16)
wv = nt.nodes.new("ShaderNodeTexWave"); wv.wave_type = "BANDS"
try: wv.bands_direction = "Y"
except Exception: pass
wv.inputs["Scale"].default_value = 1.0
rp = nt.nodes.new("ShaderNodeValToRGB"); rp.color_ramp.interpolation = "CONSTANT"
rp.color_ramp.elements[0].color = (0.10, 0.52, 0.18, 1); rp.color_ramp.elements[1].color = (0.15, 0.64, 0.23, 1)
# subtle grass noise on top
nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 400; mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "MULTIPLY"; mix.inputs["Fac"].default_value = 0.12
nt.links.new(co.outputs["Object"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
nt.links.new(wv.outputs["Fac"], rp.inputs["Fac"]); nt.links.new(rp.outputs["Color"], mix.inputs["Color1"])
nt.links.new(nz.outputs["Color"], mix.inputs["Color2"]); nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
pitch.data.materials.append(pm)

# ---------- goal + net ----------
white = mat("GoalWhite", (0.96, 0.98, 1.0), rough=0.3)
def bar(p1, p2):
    p1 = mathutils.Vector(p1); p2 = mathutils.Vector(p2); mid = (p1 + p2) / 2; v = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=v.length, location=mid); o = bpy.context.object
    o.rotation_mode = "QUATERNION"; o.rotation_quaternion = v.to_track_quat("Z", "Y"); o.data.materials.append(white); o["scene"] = 1; return o
posts = [bar((-GW/2, GZ, 0), (-GW/2, GZ, GH)), bar((GW/2, GZ, 0), (GW/2, GZ, GH)), bar((-GW/2, GZ, GH), (GW/2, GZ, GH))]
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, GZ - 0.85, GH/2)); net = bpy.context.object; net.name = "Net"
net.scale = (GW/2, 1, GH/2); net.rotation_euler = (math.radians(90), 0, 0); bpy.ops.object.transform_apply(scale=True, rotation=True)
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.subdivide(number_cuts=26); bpy.ops.object.mode_set(mode="OBJECT")
net.modifiers.new("wf", "WIREFRAME").thickness = 0.012; net.data.materials.append(mat("Net", (0.85, 0.88, 0.95), rough=0.6))

# ---------- stadium stands (tiered dark with crowd speckle) ----------
smat = bpy.data.materials.new("Stands"); smat.use_nodes = True; sn = smat.node_tree; sb = sn.nodes["Principled BSDF"]
sb.inputs["Base Color"].default_value = (0.16, 0.18, 0.24, 1)
cn = sn.nodes.new("ShaderNodeTexNoise"); cn.inputs["Scale"].default_value = 120
cr = sn.nodes.new("ShaderNodeValToRGB"); cr.color_ramp.elements[0].position = 0.55
cr.color_ramp.elements[0].color = (0.1, 0.11, 0.14, 1); cr.color_ramp.elements[1].color = (0.8, 0.8, 0.85, 1)
sn.links.new(cn.outputs["Fac"], cr.inputs["Fac"]); sn.links.new(cr.outputs["Color"], sb.inputs["Base Color"])
for (x, y, rz, sz) in [(0, GZ - 7, 0, 60), (-30, -4, math.radians(72), 50), (30, -4, math.radians(-72), 50)]:
    bpy.ops.mesh.primitive_plane_add(size=sz, location=(x, y, 8)); s = bpy.context.object
    s.rotation_euler = (math.radians(74), 0, rz); s.data.materials.append(smat); s.name = "Stand"

# ---------- daytime sky + sun ----------
w = bpy.data.worlds.new("Day"); bpy.context.scene.world = w; w.use_nodes = True
wb = w.node_tree.nodes["Background"]; wb.inputs[0].default_value = (0.42, 0.6, 0.92, 1); wb.inputs[1].default_value = 1.5
bpy.ops.object.light_add(type="SUN", location=(7, 7, 18)); sun = bpy.context.object
sun.data.energy = 4.5; sun.data.angle = math.radians(2.5); sun.data.color = (1.0, 0.97, 0.9)
sun.rotation_euler = (math.radians(54), math.radians(6), math.radians(-42))
bpy.ops.object.light_add(type="AREA", location=(-9, 6, 9)); fl = bpy.context.object
fl.data.energy = 2000; fl.data.size = 20; fl.data.color = (0.6, 0.75, 1.0); fl.rotation_euler = (math.radians(52), 0, math.radians(42))

# ---------- ball (reference; also part of bg) ----------
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, location=(0, 2.2, 0.16)); ball = bpy.context.object; ball.name = "Ball"
ball.data.materials.append(mat("Ball", (0.97, 0.97, 0.99), rough=0.3)); bpy.ops.object.shade_smooth()

# ---------- camera: raised hero — taker lower-centre (no occlusion), goal+keeper above ----------
bpy.ops.object.camera_add(location=(0.0, 5.8, 2.7)); cam = bpy.context.object; bpy.context.scene.camera = cam
cam.data.lens = 36; look = mathutils.Vector((0, -4.2, 0.75))
cam.rotation_euler = (cam.location - look).to_track_quat("Z", "Y").to_euler()
cam.data.dof.use_dof = True; cam.data.dof.focus_distance = 8.5; cam.data.dof.aperture_fstop = 4.0

# ---------- players ----------
bpy.ops.import_scene.gltf(filepath="public/models/players.glb")
TAKER, KEEPER = "GLTF_created_1", "GLTF_created_2"  # green, purple
kill = []
for o in bpy.data.objects:
    if o.type == "ARMATURE" and o.name not in (TAKER, KEEPER): kill.append(o.name)
    elif o.type == "MESH" and o.name.startswith("Icosphere"): kill.append(o.name)
    elif o.parent and o.parent.type == "ARMATURE" and o.parent.name not in (TAKER, KEEPER): kill.append(o.name)
for n in kill:
    ob = bpy.data.objects.get(n)
    if ob: bpy.data.objects.remove(ob, do_unlink=True)

def mesh_of(arm): return next((c for c in arm.children if c.type == "MESH"), None)
def place(arm, tx, ty, rz):
    m = mesh_of(arm); bpy.context.view_layer.update()
    bb = [m.matrix_world @ mathutils.Vector(c) for c in m.bound_box]
    xc = (min(v.x for v in bb) + max(v.x for v in bb)) / 2; yc = (min(v.y for v in bb) + max(v.y for v in bb)) / 2
    arm.location.x += tx - xc; arm.location.y += ty - yc; arm.rotation_euler = (0, 0, rz)
taker = bpy.data.objects[TAKER]; keeper = bpy.data.objects[KEEPER]
place(taker, 0.0, 2.2, 0.0)          # at the spot, facing goal (-Y)
place(keeper, 0.0, GZ + 0.45, math.pi)  # in goal, facing shooter (+Y)
for a in (taker, keeper):
    a.rotation_mode = "XYZ"
    for pb in a.pose.bones: pb.rotation_mode = "XYZ"

def bmap(arm): return {pb.name.rsplit("_", 1)[0]: pb for pb in arm.pose.bones}
TB, KB = bmap(taker), bmap(keeper)
def pose(bm, d):
    for pb in bm.values(): pb.rotation_euler = (0, 0, 0)
    for name, (x, y, z) in d.items():
        pb = bm.get(name)
        if pb: pb.rotation_euler = (math.radians(x), math.radians(y), math.radians(z))

# ---------- render helpers ----------
sc = bpy.context.scene; sc.render.engine = "BLENDER_EEVEE"
vt = [v.name for v in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items]
sc.view_settings.view_transform = "AgX" if "AgX" in vt else "Filmic"
sc.render.resolution_x = 768; sc.render.resolution_y = 1024
SCENE_OBJS = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(("Pitch", "Cylinder", "Net", "Stand", "Ball"))]
def show(objs, vis):
    for o in objs: o.hide_render = not vis
def render(path, transparent):
    sc.render.film_transparent = transparent; sc.render.filepath = os.path.join(OUT, path)
    bpy.ops.render.render(write_still=True)

# bg: scene only, no players, NO ball (CSS animates the ball in-app)
taker.hide_render = True; keeper.hide_render = True; mesh_of(taker).hide_render = True; mesh_of(keeper).hide_render = True
show(SCENE_OBJS, True); ball.hide_render = True
render("bg.png", False)

# character sprites: only that player, transparent, scene geo hidden (lights stay)
show(SCENE_OBJS, False)
def render_player(arm, path, posed):
    other = keeper if arm is taker else taker
    arm.hide_render = False; mesh_of(arm).hide_render = False
    other.hide_render = True; mesh_of(other).hide_render = True
    posed(); bpy.context.view_layer.update(); render(path, True)

KICK = {"thigh.R": (55, 0, 0), "shin.R": (28, 0, 0), "spine.003": (12, 0, 0), "thigh.L": (-8, 0, 0)}
render_player(taker, "taker_idle.png", lambda: pose(TB, {}))
render_player(taker, "taker_kick.png", lambda: pose(TB, KICK))

# keeper dives: bone-neutral; tilt + shift the whole armature within the goal
base_loc = keeper.location.copy()
def keeper_pose(tilt, dx, posed=None):
    pose(KB, posed or {}); keeper.location = (base_loc.x + dx, base_loc.y, base_loc.z); keeper.rotation_euler = (0, tilt, math.pi)
render_player(keeper, "keeper_ready.png", lambda: keeper_pose(0, 0, {"thigh.L": (0,0,14), "thigh.R": (0,0,-14)}))
render_player(keeper, "keeper_dive_l.png", lambda: keeper_pose(math.radians(62), -1.6))
render_player(keeper, "keeper_dive_r.png", lambda: keeper_pose(math.radians(-62), 1.6))
render_player(keeper, "keeper_catch.png", lambda: keeper_pose(0, 0, {"upper_arm.L": (-80,0,0), "upper_arm.R": (-80,0,0)}))
keeper.location = base_loc; keeper.rotation_euler = (0, 0, math.pi)
print("DONE assets ->", OUT, os.listdir(OUT))
