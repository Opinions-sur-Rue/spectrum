"""Bounded 16 kHz mono PCM segmentation, with injectable VAD for unit tests."""
from collections import deque
from dataclasses import dataclass
import uuid

SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME_BYTES = SAMPLE_RATE * FRAME_MS // 1000 * 2
MAX_UTTERANCE_MS = 12000
PARTIAL_OFFSETS_MS = (1600, 4800)


@dataclass
class Chunk:
    id: str
    pcm: bytes
    start: int
    end: int
    final: bool


class Segmenter:
    def __init__(self, vad, origin_ms: int):
        self.vad = vad
        self.origin = origin_ms
        self.position = 0
        self.preroll = deque(maxlen=10)
        self.frames = []
        self.start = 0
        self.speech = 0
        self.silence = 0
        self.partial_count = 0
        self.id = ""

    def feed(self, frame: bytes) -> list[Chunk]:
        if len(frame) != FRAME_BYTES:
            raise ValueError("Expected a 20 ms, 16 kHz mono s16 frame")
        voiced = self.vad.is_speech(frame, SAMPLE_RATE)
        self.position += FRAME_MS
        if not self.frames:
            if not voiced:
                self.preroll.append(frame)
                return []
            self.start = self.origin + self.position - FRAME_MS * (len(self.preroll) + 1)
            self.frames = list(self.preroll)
            self.preroll.clear()
            self.id = "t_" + uuid.uuid4().hex
        self.frames.append(frame)
        self.speech += FRAME_MS if voiced else 0
        self.silence = 0 if voiced else self.silence + FRAME_MS
        duration = len(self.frames) * FRAME_MS
        # Prefer real pauses to arbitrary four-second cuts in the middle of a
        # sentence. An absolute cap still bounds memory and inference cost.
        if duration >= MAX_UTTERANCE_MS or self.silence >= 800 or (duration >= 8000 and self.silence >= 200):
            return self.flush()
        if self.partial_count < len(PARTIAL_OFFSETS_MS) and duration >= PARTIAL_OFFSETS_MS[self.partial_count] and self.speech >= 200:
            self.partial_count += 1
            return [self._chunk(False)]
        return []

    def _chunk(self, final):
        return Chunk(self.id, b"".join(self.frames), self.start, self.origin + self.position, final)

    def flush(self) -> list[Chunk]:
        result = [self._chunk(True)] if self.frames and self.speech >= 200 else []
        self.frames = []
        self.speech = self.silence = 0
        self.partial_count = 0
        return result
