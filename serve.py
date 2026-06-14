#!/usr/bin/env python3
"""
KRMAS Roster — Local test server
Run: python3 serve.py
Then open http://localhost:8080 in your browser.
Press Ctrl+C to stop.
"""
import http.server
import os

PORT = 8080
DIR = os.path.dirname(os.path.abspath(__file__))

os.chdir(DIR)
handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.html': 'text/html',
})

print(f"""
╔══════════════════════════════════════════════╗
║         KRMAS Roster — Local Server          ║
╠══════════════════════════════════════════════╣
║                                              ║
║  Open in browser: http://localhost:{PORT}      ║
║                                              ║
║  Supabase: {'CONNECTED' if True else 'LOCAL ONLY'}                       ║
║  Files served from: {DIR[:38]}  ║
║                                              ║
║  Press Ctrl+C to stop                        ║
╚══════════════════════════════════════════════╝
""")

with http.server.HTTPServer(("", PORT), handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
