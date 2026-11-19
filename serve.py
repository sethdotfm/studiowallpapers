"""Static server for the app. Sends no-store so browsers always load the current files;
plain `python3 -m http.server` lets them reuse stale copies after an edit."""
import http.server
import json
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
HOST = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"


def lan_ip():
    # Connecting a UDP socket sends nothing; it only makes the OS pick the outgoing interface.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return None


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        # The page asks for this so kiosk links built on the server machine point at its network address.
        if self.path == "/__lan":
            body = json.dumps({"ip": lan_ip()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


http.server.ThreadingHTTPServer((HOST, PORT), NoStore).serve_forever()
