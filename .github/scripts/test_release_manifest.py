"""Exercise beta release manifest assembly and digest capture without Docker."""

import json
import os
import pathlib
import subprocess
import tempfile
import unittest

SCRIPTS = pathlib.Path(__file__).parent
PUSH = SCRIPTS / "push-digest.sh"
MANIFEST = SCRIPTS / "write-beta-manifest.sh"
PREFIX = "ghcr.io/opinions-sur-rue/spectrum"
DIGEST = "sha256:" + "a" * 64
BUILD_DIGEST = "sha256:" + "b" * 64


def run(args, cwd, env=None):
    return subprocess.run(
        ["bash", *map(str, args)],
        cwd=cwd,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


class PushDigestTest(unittest.TestCase):
    def fake_docker(self, lines):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        docker = pathlib.Path(directory.name, "docker")
        docker.write_text("#!/usr/bin/env bash\n" + "\n".join(lines) + "\n")
        docker.chmod(0o755)
        return directory.name

    def push(self, path, reference=f"{PREFIX}-frontend:v2.0.0-beta.5"):
        return run([PUSH, reference], path, {"PATH": f"{path}:{os.environ['PATH']}"})

    def test_uses_registry_digest_not_build_digest(self):
        path = self.fake_docker(
            [
                f'echo "Digest: {BUILD_DIGEST}"',
                f'echo "v2.0.0-beta.5: digest: {DIGEST} size: 2189"',
            ]
        )
        result = self.push(path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), DIGEST)
        self.assertNotIn(BUILD_DIGEST, result.stdout)

    def test_fails_when_push_reports_no_digest(self):
        path = self.fake_docker(['echo "pushed without detail"'])
        result = self.push(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reported no registry digest", result.stderr)

    def test_propagates_push_failure(self):
        path = self.fake_docker(['echo "denied" >&2', "exit 1"])
        result = self.push(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("denied", result.stderr)


class ManifestTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cwd = pathlib.Path(directory.name)
        self.env = {
            "PREFIX": PREFIX,
            "RELEASE_TAG": "v2.0.0-beta.5",
            "SOURCE_SHA": "c" * 40,
            "API_URL": "https://api.spectrum.utile.space",
            "PUBLIC_URL": "https://spectrum.utile.space",
        }

    def write_refs(self, frontend, backend):
        (self.cwd / "frontend-image.txt").write_text(frontend + "\n")
        (self.cwd / "backend-image.txt").write_text(backend + "\n")

    def test_records_pullable_digest_refs(self):
        self.write_refs(f"{PREFIX}-frontend@{DIGEST}", f"{PREFIX}-backend@{DIGEST}")
        result = run([MANIFEST], self.cwd, self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.cwd / "beta-images.json").read_text())
        self.assertEqual(manifest["frontend"], f"{PREFIX}-frontend@{DIGEST}")
        self.assertEqual(manifest["backend"], f"{PREFIX}-backend@{DIGEST}")
        self.assertEqual(manifest["commit"], "c" * 40)

    def test_rejects_local_smoke_tag_reference(self):
        self.write_refs(f"spectrum-beta-smoke@{DIGEST}", f"{PREFIX}-backend@{DIGEST}")
        result = run([MANIFEST], self.cwd, self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not a digest-pinned", result.stderr)

    def test_rejects_mutable_tag_and_wrong_component(self):
        self.write_refs(f"{PREFIX}-backend@{DIGEST}", f"{PREFIX}-backend:latest")
        result = run([MANIFEST], self.cwd, self.env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not a digest-pinned", result.stderr)

    def test_requires_every_value(self):
        self.write_refs(f"{PREFIX}-frontend@{DIGEST}", f"{PREFIX}-backend@{DIGEST}")
        env = dict(self.env)
        env.pop("SOURCE_SHA")
        result = run([MANIFEST], self.cwd, env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SOURCE_SHA is required", result.stderr)


if __name__ == "__main__":
    unittest.main()
