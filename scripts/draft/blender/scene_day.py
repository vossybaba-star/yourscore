import bpy, math, mathutils
sc = bpy.context.scene
# --- daytime sky world (bright blue, soft) ---
w = bpy.data.worlds.new("Day"); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.45, 0.62, 0.9, 1); bg.inputs[1].default_value = 1.6
# --- kill night floodlights/rim, add a sun + soft fill ---
for o in list(bpy.data.objects):
    if o.type == "LIGHT": bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.light_add(type="SUN", location=(6, 8, 16)); sun = bpy.context.object
sun.data.energy = 4.0; sun.data.angle = math.radians(3); sun.data.color = (1.0, 0.97, 0.9)
sun.rotation_euler = (math.radians(52), math.radians(8), math.radians(-40))
bpy.ops.object.light_add(type="AREA", location=(-8, 6, 8)); fill = bpy.context.object
fill.data.energy = 1500; fill.data.size = 18; fill.data.color = (0.6, 0.75, 1.0)
fill.rotation_euler = (math.radians(50), 0, math.radians(40))
# --- brighten pitch greens ---
pm = bpy.data.materials.get("Pitch")
if pm:
    ramp = next((n for n in pm.node_tree.nodes if n.type == "VALTORGB"), None)
    if ramp:
        ramp.color_ramp.elements[0].color = (0.10, 0.55, 0.18, 1)
        ramp.color_ramp.elements[1].color = (0.16, 0.68, 0.24, 1)
# --- lighten stands to daytime concrete/crowd ---
sm = bpy.data.materials.get("Stands")
if sm:
    b = sm.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = (0.28, 0.3, 0.36, 1)
    b.inputs["Emission Strength"].default_value = 0.0
sc.view_settings.look = "AgX - Medium High Contrast" if any("Medium High" in l.name for l in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items) else "None"
sc.render.resolution_x = 1080; sc.render.resolution_y = 1350
sc.render.filepath = "/tmp/blender/scene_day.png"
bpy.ops.render.render(write_still=True)
print("RENDERED day")
