import os
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        # 动态拦截 manifest.json 请求，直接读取目录文件并返回
        if self.path.endswith('/src/presets/manifest.json'):
            try:
                presets_dir = os.path.join(os.getcwd(), 'src', 'presets')
                if os.path.exists(presets_dir):
                    files = [f for f in os.listdir(presets_dir) if f.endswith('.json') and f != 'manifest.json']
                else:
                    files = []
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(files).encode('utf-8'))
                return
            except Exception as e:
                print("Error generating manifest:", e)
        
        super().do_GET()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 9000), NoCacheHandler)
    print("Serving on http://127.0.0.1:9000")
    server.serve_forever()
