import bpy
PORT = 9879  # 9876 is taken by the user's email-preview http.server
bpy.ops.preferences.addon_enable(module="blender_mcp_addon")
sc = bpy.context.scene
try:
    bpy.ops.blendermcp.stop_server()
except Exception:
    pass
try:
    sc.blendermcp_port = PORT
except Exception:
    pass
try:
    bpy.ops.blendermcp.start_server()
except Exception as e:
    print("[start_mcp] start_server:", e)
print(f"[start_mcp] BlenderMCP live on :{PORT}")
