#!/usr/bin/env python3
"""Tiny client for the running Blender MCP addon socket (default :9879).
Lets us drive the LIVE GUI Blender (execute bpy, grab viewport screenshots) from
the shell — no Claude Code MCP connection needed.

Usage:
  bl.py info
  bl.py shot /tmp/blender/view.png [max_size]
  bl.py code path/to/script.py
  bl.py eval 'import bpy; print(len(bpy.data.objects))'
"""
import socket, json, sys, os

HOST = os.environ.get("BLENDER_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLENDER_PORT", "9879"))


def send(cmd, timeout=120):
    s = socket.create_connection((HOST, PORT), timeout=timeout)
    s.settimeout(timeout)
    s.sendall(json.dumps(cmd).encode("utf-8"))
    buf = b""
    while True:
        chunk = s.recv(1 << 20)
        if not chunk:
            break
        buf += chunk
        try:
            json.loads(buf.decode("utf-8"))
            break
        except Exception:
            continue
    s.close()
    return json.loads(buf.decode("utf-8"))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "info"
    if mode == "info":
        r = send({"type": "get_scene_info", "params": {}})
    elif mode == "shot":
        path = sys.argv[2]
        mx = int(sys.argv[3]) if len(sys.argv) > 3 else 900
        os.makedirs(os.path.dirname(path), exist_ok=True)
        r = send({"type": "get_viewport_screenshot", "params": {"filepath": path, "max_size": mx, "format": "png"}})
    elif mode == "code":
        code = open(sys.argv[2]).read()
        r = send({"type": "execute_code", "params": {"code": code}})
    elif mode == "eval":
        r = send({"type": "execute_code", "params": {"code": sys.argv[2]}})
    else:
        print("unknown mode", mode); sys.exit(2)
    print(json.dumps(r)[:4000])


if __name__ == "__main__":
    main()
