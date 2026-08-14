"""探针:记录收到的 Authorization header,验证 cordis !!js headers 表达式。"""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        print(f"RECV {self.path} AUTH={self.headers.get('Authorization', 'NONE')!r} BODY={body[:140]!r}", flush=True)
        if b'"method":"initialize"' in body:
            resp = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "probe", "version": "0"},
            }}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("mcp-session-id", "probe-session")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        else:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", 18767), H).serve_forever()
