"""Exercise the CI readiness gate without Docker or external network services."""

import http.server
import pathlib
import socket
import struct
import subprocess
import threading
import unittest


SCRIPT = pathlib.Path(__file__).with_name("wait-for-http.sh")


class ReadinessTest(unittest.TestCase):
    def run_probe(self, handler):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            return subprocess.run(
                ["bash", str(SCRIPT), f"http://127.0.0.1:{server.server_port}/"],
                capture_output=True,
                text=True,
                timeout=40,
                check=False,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_recovers_after_connection_reset(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            attempts = 0

            def do_GET(self):
                type(self).attempts += 1
                if type(self).attempts == 1:
                    self.connection.setsockopt(
                        socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0)
                    )
                    self.connection.close()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ready")

            def log_message(self, *_args):
                pass

        result = self.run_probe(Handler)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertGreaterEqual(Handler.attempts, 2)
        self.assertIn("(56)", result.stderr)

    def test_permanently_unhealthy_service_still_fails(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(503)
                self.end_headers()

            def log_message(self, *_args):
                pass

        result = self.run_probe(Handler)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("503", result.stderr)


if __name__ == "__main__":
    unittest.main()
