#!/usr/bin/env bash
# Opens Blender (GUI) with the MCP socket server live on :9879, then restart
# Claude Code so the `blender` MCP connects.
exec /Applications/Blender.app/Contents/MacOS/Blender \
  --python "$(dirname "$0")/start_mcp.py"
