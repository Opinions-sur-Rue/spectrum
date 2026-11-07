"""Experimental CPU ASR client. WAV uploads stay in RAM on a private network.

The optional NeMo-Speech.cpp server loads local weights once. This first adapter
uses the existing bounded utterance/draft pipeline, NOT cache-aware live streams.
"""
import io
import json
import wave

import httpx
import numpy as np
from faster_whisper.vad import VadOptions, get_speech_timestamps


class NemotronRecognizer:
    def __init__(self, url="http://nemotron:8080", *, transport=None):
        self.client = httpx.Client(
            base_url=url, timeout=30, trust_env=False, follow_redirects=False,
            transport=transport,
        )

    def ready(self):
        response = self.client.get("/ready")
        response.raise_for_status()
        state = response.json()
        if state.get("ready") is not True or state.get("device") != "cpu":
            raise RuntimeError("Local CPU ASR is not ready")

    def close(self):
        self.client.close()

    def recognize(self, pcm, language="fr", final=True):
        if language not in ("fr", "en", "auto"):
            raise ValueError("Unsupported transcription language")
        if len(pcm) % 2 or len(pcm) > 16000 * 2 * 60:
            raise ValueError("Expected at most 60 seconds of mono PCM16")
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        speech = get_speech_timestamps(audio, VadOptions(
            min_speech_duration_ms=200, min_silence_duration_ms=250, speech_pad_ms=200,
        )) if len(audio) else []
        if not speech:
            return "", ""
        # Same local Silero gate as Whisper; no temporary audio files.
        voiced = b"".join(pcm[item["start"] * 2:item["end"] * 2] for item in speech)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(voiced)
        locale = {"fr": "fr-FR", "en": "en-US", "auto": "auto"}[language]
        with self.client.stream(
            "POST", "/v1/audio/transcriptions",
            data={"language": locale, "response_format": "verbose_json"},
            files={"file": ("utterance.wav", buffer.getvalue(), "audio/wav")},
        ) as response:
            response.raise_for_status()
            result = bytearray()
            for part in response.iter_bytes(chunk_size=16384):
                if len(result) + len(part) > 65536:
                    raise ValueError("Local ASR response too large")
                result.extend(part)
            result = json.loads(result)
        detected = result.get("language", "").lower().split("-")[0]
        text = result.get("text", "")
        if not isinstance(text, str) or detected not in ("fr", "en"):
            return "", ""
        return text.strip()[:4000], detected
