import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__line__)) if '__line__' in locals() else os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
        
    def end_headers(self):
        # Allow CORS if needed, and disable caching for development
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

def main():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving files from {DIRECTORY} at http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        
        # Open the default web browser
        webbrowser.open_new(f"http://localhost:{PORT}")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            sys.exit(0)

if __name__ == "__main__":
    main()
