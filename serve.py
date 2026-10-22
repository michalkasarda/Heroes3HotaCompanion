#!/usr/bin/env python3
"""Local server for the Mysterious Island atlas. Run: python3 serve.py  then open http://localhost:8765"""
import http.server, json, os, sys, urllib.parse, webbrowser, threading

SAVE_DIR = "/home/michal-work/.var/app/com.usebottles.bottles/data/bottles/bottles/Heroes3/drive_c/Heroes3Complete/Games"
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")
PORT = 8765

def list_saves():
    out = []
    for root, dirs, files in os.walk(SAVE_DIR):
        depth = root[len(SAVE_DIR):].count(os.sep)
        if depth >= 2:
            dirs[:] = []
        for f in files:
            if f.upper().endswith((".GM1", ".GM2", ".CGM")):
                p = os.path.join(root, f)
                st = os.stat(p)
                out.append(dict(name=os.path.relpath(p, SAVE_DIR).replace(os.sep, "/"), mtime=st.st_mtime, size=st.st_size))
    out.sort(key=lambda s: -s["mtime"])
    return out

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=APP, **k)
    def log_message(self, *a):
        pass
    def do_GET(self):
        if self.path == "/api/saves":
            body = json.dumps(dict(dir=SAVE_DIR, saves=list_saves())).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        if self.path.startswith("/api/save/"):
            name = urllib.parse.unquote(self.path[len("/api/save/"):])
            p = os.path.normpath(os.path.join(SAVE_DIR, name))
            if not p.startswith(SAVE_DIR) or not os.path.isfile(p):
                self.send_error(404); return
            data = open(p, "rb").read()
            self.send_response(200); self.send_header("Content-Type", "application/octet-stream"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        super().do_GET()

if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
    url = "http://localhost:%d/" % PORT
    print("Mysterious Island atlas at", url, "(Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    srv.serve_forever()
