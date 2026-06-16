"""v2: env polish (stands backdrop, floodlight glow, lower hero cam, visible stripes)
+ import 2 StudioOchi players (taker at spot facing goal, keeper in goal facing
shooter) to judge whether good lighting redeems the model. Render still."""
import bpy, math, mathutils

bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
for c in list(bpy.data.materials): bpy.data.materials.remove(c)

def mat(name, base, rough=0.7, metal=0.0, emit=None, emit_str=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = emit_str
    return m

GW, GH, GZ, R = 7.32, 2.44, -9.0, 0.08

# ---- pitch with clear mowed stripes (object-Y bands) ----
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
pitch = bpy.context.object; pm = bpy.data.materials.new("Pitch"); pm.use_nodes = True
nt = pm.node_tree; bsdf = nt.nodes["Principled BSDF"]; bsdf.inputs["Roughness"].default_value = 0.95
coord = nt.nodes.new("ShaderNodeTexCoord"); mapping = nt.nodes.new("ShaderNodeMapping")
mapping.inputs["Scale"].default_value = (0.18, 0.18, 0.18)
wave = nt.nodes.new("ShaderNodeTexWave"); wave.wave_type = "BANDS"
try: wave.bands_direction = "Y"
except Exception: pass
wave.inputs["Scale"].default_value = 1.0
ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.color_ramp.interpolation = "CONSTANT"
ramp.color_ramp.elements[0].color = (0.045, 0.38, 0.12, 1); ramp.color_ramp.elements[1].color = (0.075, 0.5, 0.17, 1)
nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
nt.links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
pitch.data.materials.append(pm)

# ---- goal posts + net ----
white = mat("GoalWhite", (0.95, 0.97, 1.0), rough=0.3, emit=(0.9, 0.95, 1.0), emit_str=0.8)
def bar(p1, p2):
    p1 = mathutils.Vector(p1); p2 = mathutils.Vector(p2); mid = (p1 + p2) / 2; vec = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=vec.length, location=mid)
    o = bpy.context.object; o.rotation_mode = "QUATERNION"; o.rotation_quaternion = vec.to_track_quat("Z", "Y")
    o.data.materials.append(white); return o
bar((-GW/2, GZ, 0), (-GW/2, GZ, GH)); bar((GW/2, GZ, 0), (GW/2, GZ, GH)); bar((-GW/2, GZ, GH), (GW/2, GZ, GH))
# net: subdivided plane behind the mouth with a wireframe skin
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, GZ - 0.9, GH/2))
net = bpy.context.object; net.scale = (GW/2, 1, GH/2); net.rotation_euler = (math.radians(90), 0, 0)
bpy.ops.object.transform_apply(scale=True, rotation=True)
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.subdivide(number_cuts=22); bpy.ops.object.mode_set(mode="OBJECT")
wf = net.modifiers.new("wf", "WIREFRAME"); wf.thickness = 0.02
net.data.materials.append(mat("Net", (0.8, 0.85, 0.95), rough=0.6, emit=(0.6, 0.7, 0.9), emit_str=0.3))

# ---- stadium stands: dark angled backdrop ring with faint crowd speckle ----
standmat = bpy.data.materials.new("Stands"); standmat.use_nodes = True
sn = standmat.node_tree; sb = sn.nodes["Principled BSDF"]; sb.inputs["Base Color"].default_value = (0.02, 0.03, 0.06, 1)
noise = sn.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 90
cr = sn.nodes.new("ShaderNodeValToRGB"); cr.color_ramp.elements[0].position = 0.62
cr.color_ramp.elements[0].color = (0, 0, 0, 1); cr.color_ramp.elements[1].color = (0.5, 0.55, 0.7, 1)
sn.links.new(noise.outputs["Fac"], cr.inputs["Fac"]); sn.links.new(cr.outputs["Color"], sb.inputs["Emission Color"])
sb.inputs["Emission Strength"].default_value = 0.5
for (x, y, rz) in [(0, GZ - 6, 0), (-26, -2, math.radians(70)), (26, -2, math.radians(-70))]:
    bpy.ops.mesh.primitive_plane_add(size=46, location=(x, y, 7)); s = bpy.context.object
    s.rotation_euler = (math.radians(78), 0, rz); s.data.materials.append(standmat)

# ---- world + floodlights + glow ----
world = bpy.data.worlds.new("Night"); bpy.context.scene.world = world; world.use_nodes = True
wbg = world.node_tree.nodes["Background"]; wbg.inputs[0].default_value = (0.02, 0.035, 0.08, 1); wbg.inputs[1].default_value = 0.22
glow = mat("Glow", (1, 1, 1), emit=(1, 0.97, 0.9), emit_str=40)
def flood(x, y):
    bpy.ops.object.light_add(type="AREA", location=(x, y, 15)); L = bpy.context.object
    L.data.energy = 22000; L.data.size = 7; L.data.color = (1.0, 0.96, 0.88)
    L.rotation_euler = (math.radians(58), 0, math.atan2(-x, (GZ + 2) - y))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=(x, y, 14.4)); bpy.context.object.data.materials.append(glow)
for c in [(-15, 9), (15, 9), (-15, -18), (15, -18)]: flood(*c)
bpy.ops.object.light_add(type="AREA", location=(0, GZ - 3, 5)); rim = bpy.context.object
rim.data.energy = 5000; rim.data.size = 12; rim.data.color = (0.4, 0.7, 1.0); rim.rotation_euler = (math.radians(-72), 0, 0)

# ---- players ----
before = set(o.name for o in bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=bpy.path.abspath("//public/models/players.glb") if False else "public/models/players.glb")
# keep two player armatures (Soccer Man A=taker, Soccer Man C=keeper), drop the rest
KEEP = {"GLTF_created_0": ("taker", (0, 2.2, 0), 0.0),
        "GLTF_created_2": ("keeper", (0, GZ + 0.4, 0), math.pi)}
kill = []
for o in bpy.data.objects:
    if o.type == "ARMATURE" and o.name not in KEEP: kill.append(o.name)
    elif o.type == "MESH" and o.name.startswith("Icosphere"): kill.append(o.name)
    elif o.parent and o.parent.type == "ARMATURE" and o.parent.name not in KEEP: kill.append(o.name)
for n in kill:
    ob = bpy.data.objects.get(n)
    if ob: bpy.data.objects.remove(ob, do_unlink=True)
for arm_name, (role, loc, rz) in KEEP.items():
    arm = bpy.data.objects.get(arm_name)
    if arm: arm.location = loc; arm.rotation_euler = (0, 0, rz)

# ---- camera: low hero behind the spot ----
bpy.ops.object.camera_add(location=(1.1, 5.2, 1.05)); cam = bpy.context.object; bpy.context.scene.camera = cam
cam.data.lens = 38
look = mathutils.Vector((0, GZ + 1, 1.2)); cam.rotation_euler = (cam.location - look).to_track_quat("Z", "Y").to_euler()
cam.data.dof.use_dof = True; cam.data.dof.focus_distance = 8.0; cam.data.dof.aperture_fstop = 3.2

# ---- ball ----
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, location=(0, 2.2, 0.16)); bpy.context.object.data.materials.append(mat("Ball", (0.95, 0.95, 0.97), rough=0.3)); bpy.ops.object.shade_smooth()

sc = bpy.context.scene; sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = 720; sc.render.resolution_y = 960
vt = [v.name for v in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items]
sc.view_settings.view_transform = "AgX" if "AgX" in vt else "Filmic"
try: sc.eevee.use_bloom = True; sc.eevee.bloom_intensity = 0.03
except Exception: pass
sc.render.filepath = "/tmp/blender/scene_v2.png"
bpy.ops.render.render(write_still=True)
print("RENDERED /tmp/blender/scene_v2.png")
