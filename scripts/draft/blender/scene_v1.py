"""Build a stylized night-match penalty scene (environment + lighting + camera) and
render a hero still. Run via: bl.py code scripts/draft/blender/scene_v1.py
Iterate the look here, then we add players + export for R3F."""
import bpy, math, mathutils

# ---- wipe ----
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
for c in list(bpy.data.materials): bpy.data.materials.remove(c)

def mat(name, base, rough=0.7, metal=0.0, emit=None, emit_str=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_str
    return m

# ---- pitch with mowed stripes ----
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
pitch = bpy.context.object; pitch.name = "Pitch"
pm = bpy.data.materials.new("Pitch"); pm.use_nodes = True
nt = pm.node_tree; bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.95
# stripes via a wave texture driving two greens
tex = nt.nodes.new("ShaderNodeTexWave"); tex.inputs["Scale"].default_value = 2.0
tex.bands_direction = "Y" if hasattr(tex, "bands_direction") else tex.bands_direction
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.05, 0.42, 0.13, 1)
ramp.color_ramp.elements[1].color = (0.07, 0.52, 0.17, 1)
ramp.color_ramp.interpolation = "CONSTANT"
mapping = nt.nodes.new("ShaderNodeMapping"); coord = nt.nodes.new("ShaderNodeTexCoord")
nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
nt.links.new(tex.outputs["Color"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
pitch.data.materials.append(pm)

# ---- goal frame (white, slightly emissive so it pops at night) ----
white = mat("GoalWhite", (0.95, 0.97, 1.0), rough=0.35, emit=(0.9, 0.95, 1.0), emit_str=0.6)
GW, GH, GZ, R = 7.32, 2.44, -9.0, 0.08
def bar(p1, p2):
    p1 = mathutils.Vector(p1); p2 = mathutils.Vector(p2)
    mid = (p1 + p2) / 2; vec = p2 - p1; length = vec.length
    bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=length, location=mid)
    o = bpy.context.object
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = vec.to_track_quat("Z", "Y")
    o.data.materials.append(white)
    return o
bar((-GW/2, GZ, 0), (-GW/2, GZ, GH))   # left post
bar((GW/2, GZ, 0), (GW/2, GZ, GH))     # right post
bar((-GW/2, GZ, GH), (GW/2, GZ, GH))   # crossbar

# ---- world: deep night gradient ----
world = bpy.data.worlds.new("Night"); bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.02, 0.04, 0.09, 1)
bg.inputs[1].default_value = 0.25

# ---- floodlights (4 warm-white area lights up high) ----
def flood(x, y):
    bpy.ops.object.light_add(type="AREA", location=(x, y, 14))
    L = bpy.context.object; L.data.energy = 18000; L.data.size = 6
    L.data.color = (1.0, 0.96, 0.9)
    L.rotation_euler = (math.radians(55), 0, math.atan2(-x, 9 - y))
    return L
flood(-13, 10); flood(13, 10); flood(-13, -16); flood(13, -16)
# cool rim from behind the goal
bpy.ops.object.light_add(type="AREA", location=(0, GZ - 3, 5))
rim = bpy.context.object; rim.data.energy = 4000; rim.data.size = 10
rim.data.color = (0.4, 0.7, 1.0); rim.rotation_euler = (math.radians(-70), 0, 0)

# ---- camera: low, behind the spot, looking at goal ----
bpy.ops.object.camera_add(location=(0.6, 5.5, 1.5))
cam = bpy.context.object; bpy.context.scene.camera = cam
cam.data.lens = 40
look = mathutils.Vector((0, GZ + 1, 1.1))
cam.rotation_euler = (cam.location - look).to_track_quat("Z", "Y").to_euler()
cam.data.dof.use_dof = True
cam.data.dof.focus_distance = (cam.location - look).length
cam.data.dof.aperture_fstop = 2.8

# ---- ball on the spot (for scale/reference) ----
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, location=(0, 2.2, 0.16))
ball = bpy.context.object; ball.data.materials.append(mat("Ball", (0.95, 0.95, 0.97), rough=0.3))
bpy.ops.object.shade_smooth()

# ---- render settings: Eevee, portrait, filmic + bloom-ish ----
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = 720; sc.render.resolution_y = 960
sc.view_settings.view_transform = "AgX" if "AgX" in [v.name for v in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
try:
    sc.eevee.use_bloom = True; sc.eevee.bloom_intensity = 0.04
except Exception:
    pass
sc.render.film_transparent = False
sc.render.filepath = "/tmp/blender/scene_v1.png"
bpy.ops.render.render(write_still=True)
print("RENDERED /tmp/blender/scene_v1.png")
