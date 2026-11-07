"""Self-hosted, listen-only LiveKit -> CPU ASR -> ephemeral transcript.

No audio files, no cloud requests, no text/audio/token logging. One inference at
a time, bounded RTC buffers and bounded inference queue. Overload drops audio
instead of building an unbounded backlog.
"""
import asyncio
import contextlib
import logging
import os
import re
import signal
import time
import unicodedata

import httpx
import numpy as np
import webrtcvad
from faster_whisper import WhisperModel
from faster_whisper.vad import get_vad_model
from livekit import rtc

from segmenter import Segmenter, FRAME_BYTES
from nemotron import NemotronRecognizer

log = logging.getLogger("spectrum.stt")


def subtitle_artifact(text):
    # Suppress only a standalone, known auto-caption credit, not sentences
    # discussing Amara. The neural VAD is the primary non-speech gate.
    normalized = "".join(char for char in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(char))
    normalized = " ".join(re.findall(r"[a-z0-9]+", normalized))
    return normalized in {
        "sous titres realises par la communaute d amara org",
        "sous titres par la communaute d amara org",
        "subtitles by the amara org community",
    }


class Session:
    def __init__(self, worker, job):
        self.worker = worker
        self.job = job
        self.allowed = set(job["speakers"] or [])
        self.room = rtc.Room()
        self.tasks = {}
        self.partials = {}
        self.closed = False
        self.healthy = True

    async def connect(self):
        @self.room.on("track_published")
        def published(publication, participant):
            self.subscribe(publication, participant)

        @self.room.on("track_subscribed")
        def subscribed(track, publication, participant):
            if self.closed or participant.identity not in self.allowed or track.kind != rtc.TrackKind.KIND_AUDIO:
                return

            if publication.sid in self.tasks:
                return
            self.tasks[publication.sid] = asyncio.create_task(self.capture(track, participant.identity))

        @self.room.on("track_unsubscribed")
        def unsubscribed(track, publication, participant):
            task = self.tasks.pop(publication.sid, None)
            if task:
                task.cancel()

        @self.room.on("disconnected")
        def disconnected(reason):
            self.healthy = False

        await self.room.connect(os.environ["LIVEKIT_URL"], self.job["token"], options=rtc.RoomOptions(auto_subscribe=False))
        self.update(self.job)

    def subscribe(self, publication, participant):
        publication.set_subscribed(
            participant.identity in self.allowed
            and publication.kind == rtc.TrackKind.KIND_AUDIO
            and publication.source == rtc.TrackSource.SOURCE_MICROPHONE
        )

    def update(self, job):
        self.allowed = set(job["speakers"] or [])
        for participant in self.room.remote_participants.values():
            for publication in participant.track_publications.values():
                self.subscribe(publication, participant)

    def enqueue(self, speaker, chunk):
        if not self.closed and speaker in self.allowed:
            self.worker.enqueue(self, speaker, chunk)

    async def capture(self, track, speaker):
        segmenter = Segmenter(webrtcvad.Vad(2), int(time.time() * 1000))
        stream = rtc.AudioStream.from_track(track=track, sample_rate=16000, num_channels=1, frame_size_ms=20, capacity=50)
        remainder = b""
        try:
            async for event in stream:
                if self.closed or speaker not in self.allowed:
                    break
                remainder += bytes(event.frame.data)
                while len(remainder) >= FRAME_BYTES:
                    frame, remainder = remainder[:FRAME_BYTES], remainder[FRAME_BYTES:]
                    for chunk in segmenter.feed(frame):
                        self.enqueue(speaker, chunk)
        except asyncio.CancelledError:
            pass
        except Exception:
            log.warning("Audio stream failed")
        finally:
            for chunk in segmenter.flush():
                self.enqueue(speaker, chunk)
            await stream.aclose()

    async def close(self):
        self.closed = True
        self.partials.clear()
        self.worker.discard(self)
        tasks = list(self.tasks.values())
        self.tasks.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.room.disconnect()


class Worker:
    def __init__(self, model):
        self.model = model
        self.queue = asyncio.Queue(maxsize=24)
        self.sessions = {}
        self.http = httpx.AsyncClient(base_url=os.environ["SPECTRUM_BACKEND_URL"], headers={"Authorization": "Bearer " + os.environ["SPECTRUM_TRANSCRIPTION_TOKEN"]}, timeout=5)

    def discard(self, session):
        self.drop_pending(lambda item: item[0] is session)

    def drop_pending(self, predicate):
        retained = []
        drained = 0
        while not self.queue.empty():
            item = self.queue.get_nowait()
            drained += 1
            if not predicate(item):
                retained.append(item)
        for item in retained:
            self.queue.put_nowait(item)
        for _ in range(drained):
            self.queue.task_done()

    def enqueue(self, session, speaker, chunk):
        # A newer draft/final supersedes queued drafts of that utterance. Never
        # waste CPU decoding a stale draft ahead of an already available final.
        self.drop_pending(lambda item: item[0] is session and item[2].id == chunk.id and not item[2].final)
        if not chunk.final and self.queue.qsize() >= 2:
            return
        if chunk.final and self.queue.full():
            self.drop_pending(lambda item: not item[2].final)
        try:
            self.queue.put_nowait((session, speaker, chunk))
        except asyncio.QueueFull:
            log.warning("Inference queue full; dropping a chunk")

    def recognize(self, pcm, language="fr", final=True):
        if isinstance(self.model, NemotronRecognizer):
            text, detected = self.model.recognize(pcm, language, final)
            return ("", "") if subtitle_artifact(text) else (text, detected)
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        segments, info = self.model.transcribe(
            audio, task="transcribe", language=None if language == "auto" else language,
            beam_size=5 if final else 1, temperature=0.0,
            condition_on_previous_text=False, vad_filter=True,
            vad_parameters={"min_speech_duration_ms": 200, "min_silence_duration_ms": 250, "speech_pad_ms": 200},
            no_speech_threshold=0.6, log_prob_threshold=-1.0,
        )
        # faster-whisper already combines no-speech probability with decoded
        # log probability. A second no_speech-only filter drops valid phrases
        # whose text is confident despite a high silence prior.
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if subtitle_artifact(text):
            text = ""
        return (text[:4000], info.language) if info.language in ("fr", "en") else ("", "")

    async def infer(self):
        while True:
            session, speaker, chunk = await self.queue.get()
            try:
                if session.closed or speaker not in session.allowed:
                    continue
                text, language = await asyncio.to_thread(self.recognize, chunk.pcm, session.job.get("language", "fr"), chunk.final)
                if session.closed or speaker not in session.allowed:
                    continue
                if chunk.final:
                    previous = session.partials.pop(chunk.id, None)
                    if not text and previous:
                        # Never upgrade a rejected draft into a final quote.
                        # Withdraw the provisional caption using a tombstone.
                        language = previous[1]
                else:
                    previous = None
                discarded = chunk.final and not text and previous is not None
                if not text and not discarded:
                    continue
                payload = {key: session.job[key] for key in ("roomId", "voiceRoomId", "generation")}
                payload.update(speakerId=speaker, segmentId=chunk.id, text=text, start=chunk.start, end=chunk.end, language=language, final=chunk.final)
                if discarded:
                    payload["discarded"] = True
                response = await self.http.post("/spectrum/transcript", json=payload)
                if response.status_code == 204 and text and not chunk.final and not session.closed:
                    session.partials[chunk.id] = (text, language)
                    if len(session.partials) > 64:
                        del session.partials[next(iter(session.partials))]
                if response.status_code not in (204, 403, 404, 409):
                    log.warning("Transcript delivery failed (%d)", response.status_code)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("Recognition or delivery failed")
            finally:
                self.queue.task_done()
                # A coroutine suspended on the next queue.get() otherwise keeps
                # its last raw chunk and HTTP payload alive indefinitely.
                session = chunk = payload = response = previous = None
                text = language = speaker = ""

    async def reconcile(self, jobs):
        by_room = {job["voiceRoomId"]: job for job in jobs}
        # Stable admission avoids churning subscriptions when the backend's Go
        # map iteration reorders a list containing more than eight rooms.
        active = {key for key, job in by_room.items() if job["speakers"]}
        keys = [key for key in self.sessions if key in active]
        keys += sorted(active - self.sessions.keys())
        keys += [key for key in self.sessions if key in by_room and key not in active]
        keys += sorted(key for key in by_room if key not in self.sessions and key not in active)
        desired = {key: by_room[key] for key in keys[:8]}
        for key, session in list(self.sessions.items()):
            if key not in desired or not session.healthy:
                await session.close()
                del self.sessions[key]
        for key, job in desired.items():
            if key in self.sessions:
                self.sessions[key].update(job)
            else:
                session = Session(self, job)
                try:
                    await asyncio.wait_for(session.connect(), 10)
                    self.sessions[key] = session
                except Exception:
                    await session.close()
                    log.warning("Voice room subscription failed")

    async def run(self):
        inference = asyncio.create_task(self.infer())
        try:
            log.info("Model ready; polling for consenting speakers")
            while True:
                try:
                    response = await self.http.get("/spectrum/transcription/jobs")
                    response.raise_for_status()
                    await self.reconcile(response.json())
                except (httpx.HTTPError, ValueError):
                    # Fail closed: don't retain room audio when control is lost.
                    await self.reconcile([])
                    log.warning("Backend unavailable; audio subscriptions stopped")
                await asyncio.sleep(0.25)
        finally:
            await self.reconcile([])
            inference.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await inference
            await self.http.aclose()


async def main():
    logging.basicConfig(level=logging.WARNING)
    log.setLevel(logging.INFO)
    # Only local weights: download.py is the sole online step.
    engine = os.environ.get("STT_ENGINE", "whisper")
    if engine == "whisper":
        model = WhisperModel(os.environ.get("WHISPER_MODEL_PATH", "/models/whisper-small"), device="cpu", compute_type="int8", cpu_threads=4, num_workers=1, local_files_only=True)
    elif engine == "nemotron":
        model = NemotronRecognizer()
        model.ready()  # Fail closed; never advertise readiness without local ASR.
    else:
        raise ValueError("Unsupported STT_ENGINE")
    get_vad_model()  # Packaged local ONNX weights; warm before declaring ready.
    worker = Worker(model)
    task = asyncio.create_task(worker.run())
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, task.cancel)
    try:
        with contextlib.suppress(asyncio.CancelledError):
            await task
    finally:
        if isinstance(model, NemotronRecognizer):
            model.close()


if __name__ == "__main__":
    asyncio.run(main())
