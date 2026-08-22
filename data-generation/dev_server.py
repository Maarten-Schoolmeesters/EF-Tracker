"""No-cache static server for local development (app/ has ES modules that
browsers otherwise cache aggressively across reloads)."""
import http.server
import os
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
directory = sys.argv[2] if len(sys.argv) > 2 else "app"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


os.chdir(os.path.join(os.path.dirname(__file__), "..", directory))
http.server.test(HandlerClass=NoCacheHandler, port=port)
