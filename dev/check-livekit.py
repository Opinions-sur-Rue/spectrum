"""Local-only SFU smoke test; no microphone, audio capture, or external service.

Run after: docker compose -f docker-compose.dev.yaml --profile voice up -d livekit stun
The JWT helper uses public fixture credentials, never application credentials.
Production token issuance must use the official SDK behind admission checks.
"""

import base64
import hashlib
import hmac
import json
import secrets
import socket
import struct
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:7880"
KEY = "spectrum-dev"
SECRET = "spectrum-local-development-secret-not-for-production"


def token(grant, identity="dev-readiness"):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")

    now = int(time.time())
    content = encode({"alg": "HS256", "typ": "JWT"}) + b"." + encode({
        "iss": KEY, "sub": identity, "nbf": now - 5, "exp": now + 60, "video": grant,
    })
    signature = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), content, hashlib.sha256).digest()).rstrip(b"=")
    return (content + b"." + signature).decode()


def request(path, jwt=None, payload=None):
    headers = {"Content-Type": "application/json"}
    if jwt:
        headers["Authorization"] = "Bearer " + jwt
    req = urllib.request.Request(URL + path, headers=headers, data=None if payload is None else json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def main():
    transaction = secrets.token_bytes(12)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
        udp.settimeout(3)
        packet = struct.pack("!HHI", 1, 0, 0x2112A442) + transaction
        # UDP can lose the first request while the local listener starts.
        for _ in range(3):
            udp.sendto(packet, ("127.0.0.1", 3478))
            try:
                reply, _ = udp.recvfrom(2048)
                assert reply[:2] == b"\x01\x01" and reply[8:20] == transaction, "Local STUN failed"
                break
            except TimeoutError:
                pass
        else:
            raise RuntimeError("Local STUN did not answer after three attempts")
    assert request("/")[0] == 200, "SFU is not ready"
    assert request("/rtc/validate?protocol=16")[0] == 401, "Unauthenticated admission was allowed"
    room = "readiness-" + secrets.token_hex(8)
    listener = token({"roomJoin": True, "room": room, "canPublish": False, "canPublishData": False, "canSubscribe": True})
    admin = token({"roomCreate": True})
    missing = request("/rtc/validate?protocol=16", listener)[0]
    assert missing == 404, f"Unexpected automatic room creation response: {missing}"
    try:
        status, _ = request("/twirp/livekit.RoomService/CreateRoom", admin, {"name": room, "emptyTimeout": 60, "maxParticipants": 56})
        assert status == 200, f"Room creation failed: {status}"
        assert request("/rtc/validate?protocol=16", listener)[0] == 200, "Listener admission failed"
    finally:
        status, _ = request("/twirp/livekit.RoomService/DeleteRoom", admin, {"room": room})
        assert status in (200, 404), f"Room cleanup failed: {status}"
    assert request("/rtc/validate?protocol=16", listener)[0] == 404, "Retired room accepted a cached token"
    print("OK: local STUN, authenticated SFU, explicit room lifecycle; no media published")


if __name__ == "__main__":
    main()
