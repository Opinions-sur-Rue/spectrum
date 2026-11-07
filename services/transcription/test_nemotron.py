import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

import httpx

from nemotron import NemotronRecognizer


class NemotronTests(unittest.TestCase):
    def test_download_verifies_public_weights_and_allows_unprivileged_reader(self):
        import hashlib
        import os
        import download_nemotron
        payload = b"public-model-fixture"
        checksum = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"NEMOTRON_MODEL_DIR": directory}), patch.object(download_nemotron, "SHA256", checksum), patch("download_nemotron.urllib.request.urlopen", return_value=io.BytesIO(payload)):
            download_nemotron.main()
            target = Path(directory) / download_nemotron.FILENAME
            self.assertEqual(target.read_bytes(), payload)
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)
            download_nemotron.main()  # Reuses verified weights, no overwrite.
            target.write_bytes(b"unexpected-existing-work")
            with self.assertRaises(ValueError):
                download_nemotron.main()
            self.assertEqual(target.read_bytes(), b"unexpected-existing-work")

    def test_benchmark_wer_uses_words_not_punctuation_and_checks_reference(self):
        from benchmark import word_error_rate
        self.assertEqual(word_error_rate("Bonjour, l’audio !", "bonjour l'audio"), 0)
        self.assertEqual(word_error_rate("un deux trois", "un quatre trois"), 1 / 3)
        self.assertEqual(word_error_rate("un deux", "un deux trois"), 0.5)
        with self.assertRaises(ValueError):
            word_error_rate("", "bonjour")

    def make_recognizer(self, handler):
        model = NemotronRecognizer(transport=httpx.MockTransport(handler))
        self.addCleanup(model.close)
        return model

    @patch("nemotron.get_speech_timestamps", return_value=[{"start": 0, "end": 1600}])
    def test_wav_in_memory_and_explicit_french_no_translation(self, vad):
        requests = []

        def handle(request):
            requests.append(request)
            body = request.read()
            self.assertIn(b"fr-FR", body)
            self.assertIn(b"verbose_json", body)
            start = body.index(b"RIFF")
            wav_bytes = body[start:start + 44 + 3200]
            with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
                self.assertEqual((wav.getnchannels(), wav.getframerate(), wav.getsampwidth()), (1, 16000, 2))
                self.assertEqual(wav.readframes(1600), bytes(3200))
            self.assertEqual(request.url.path, "/v1/audio/transcriptions")
            return httpx.Response(200, json={"text": " Bonjour. ", "language": "fr-FR"})

        model = self.make_recognizer(handle)
        self.assertEqual(model.recognize(bytes(3200), "fr"), ("Bonjour.", "fr"))
        self.assertEqual(len(requests), 1)

    @patch("nemotron.get_speech_timestamps", return_value=[])
    def test_silence_never_uploaded(self, vad):
        def unexpected(request):
            self.fail("Silence sent for recognition")

        self.assertEqual(self.make_recognizer(unexpected).recognize(bytes(3200)), ("", ""))

    @patch("nemotron.get_speech_timestamps", return_value=[{"start": 0, "end": 1600}])
    def test_auto_rejects_languages_outside_fr_en_and_caps_text(self, vad):
        for detected, expected in [("de-DE", ("", "")), ("en-US", ("x" * 4000, "en"))]:
            def handle(request):
                self.assertIn(b"auto", request.read())
                return httpx.Response(200, json={"text": "x" * 4100, "language": detected})
            self.assertEqual(self.make_recognizer(handle).recognize(bytes(3200), "auto"), expected)

    @patch("nemotron.get_speech_timestamps", return_value=[{"start": 0, "end": 1600}])
    def test_errors_redirects_and_oversized_responses_fail_closed(self, vad):
        for status in (302, 500):
            model = self.make_recognizer(lambda request: httpx.Response(status, headers={"Location": "https://example.invalid"}))
            with self.assertRaises(httpx.HTTPStatusError):
                model.recognize(bytes(3200))
        model = self.make_recognizer(lambda request: httpx.Response(200, content=json.dumps({"text": "x" * 70000})))
        with self.assertRaises(ValueError):
            model.recognize(bytes(3200))

    def test_not_ready_never_claims_readiness(self):
        for state in ({"ready": False}, {"ready": True, "device": "cuda:0"}):
            model = self.make_recognizer(lambda request: httpx.Response(200, json=state))
            with self.assertRaises(RuntimeError):
                model.ready()
        self.make_recognizer(lambda request: httpx.Response(200, json={"ready": True, "device": "cpu"})).ready()


if __name__ == "__main__":
    unittest.main()
