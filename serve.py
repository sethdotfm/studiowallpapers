"""Static server for the app. Sends no-store so browsers always load the current files;
plain `python3 -m http.server` lets them reuse stale copies after an edit."""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
HOST = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


http.server.ThreadingHTTPServer((HOST, PORT), NoStore).serve_forever()
