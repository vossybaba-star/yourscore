import bpy
try:
    bpy.ops.preferences.addon_enable(module="blender_mcp_addon")
    print("[start_mcp] addon enabled; MCP socket server should be live on :9876")
except Exception as e:
    print("[start_mcp] enable failed:", e)
