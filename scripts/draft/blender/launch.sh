#!/usr/bin/env bash
# Opens Blender (GUI) with the penalty rig loaded and the MCP socket server live.
# Then restart Claude Code so the `blender` MCP (uvx blender-mcp) connects to :9876.
exec /Applications/Blender.app/Contents/MacOS/Blender \
  "$(dirname "$0")/../../../public/models/players.glb" \
  --python "$(dirname "$0")/start_mcp.py"
