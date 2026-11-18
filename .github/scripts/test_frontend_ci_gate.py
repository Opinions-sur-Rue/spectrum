"""Exercise the actual inline frontend aggregate gate without YAML dependencies."""

import itertools
import os
import pathlib
import re
import subprocess
import unittest


WORKFLOW = pathlib.Path(__file__).parents[1] / "workflows/release-v2-beta.yml"


class FrontendGateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = WORKFLOW.read_text()
        job = re.search(r"^  frontend:\n(.*?)(?=^  \w|\Z)", workflow, re.M | re.S)
        if job is None:
            raise AssertionError("Missing frontend aggregate job")
        cls.job = job.group(1)
        script = re.search(r"^        run: \|\n((?:          .*\n|\n)+)", cls.job, re.M)
        if script is None:
            raise AssertionError("Missing inline frontend gate")
        cls.script = "\n".join(line[10:] for line in script.group(1).splitlines())

    def test_dependencies_and_always_condition(self):
        self.assertIn("needs: [release, frontend-checks, frontend-ui, frontend-voice]", self.job)
        self.assertIn("if: ${{ always() && needs.release.result == 'success' }}", self.job)
        for variable, child in (
            ("CHECKS_RESULT", "frontend-checks"),
            ("UI_RESULT", "frontend-ui"),
            ("VOICE_RESULT", "frontend-voice"),
        ):
            self.assertIn(f"{variable}: ${{{{ needs.{child}.result }}}}", self.job)

    def test_all_status_combinations(self):
        # Empty means a missing result; unknown statuses must also fail closed.
        statuses = ("success", "failure", "cancelled", "skipped", "", "unknown")
        for results in itertools.product(statuses, repeat=3):
            with self.subTest(results=results):
                env = dict(os.environ)
                env.update(zip(("CHECKS_RESULT", "UI_RESULT", "VOICE_RESULT"), results))
                result = subprocess.run(
                    ["bash", "--noprofile", "--norc", "-c", self.script],
                    env=env, capture_output=True, text=True, timeout=5, check=False,
                )
                self.assertEqual(result.returncode == 0, results == ("success",) * 3,
                                 result.stdout + result.stderr)

    def test_unset_results_rejected(self):
        for missing in ("CHECKS_RESULT", "UI_RESULT", "VOICE_RESULT"):
            with self.subTest(missing=missing):
                env = dict(os.environ, CHECKS_RESULT="success", UI_RESULT="success",
                           VOICE_RESULT="success")
                env.pop(missing)
                result = subprocess.run(
                    ["bash", "--noprofile", "--norc", "-c", self.script],
                    env=env, capture_output=True, text=True, timeout=5, check=False,
                )
                self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
