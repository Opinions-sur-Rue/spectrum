import asyncio
import contextlib
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

from segmenter import Chunk
from worker import Worker, subtitle_artifact


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_close_discards_only_retired_room_audio(self):
        worker = object.__new__(Worker)
        worker.queue = asyncio.Queue(maxsize=24)
        retired, active = object(), object()
        chunk = Chunk("utterance", b"raw-audio", 0, 1000, True)
        worker.queue.put_nowait((retired, "m_old", chunk))
        worker.queue.put_nowait((active, "m_current", chunk))
        worker.discard(retired)
        self.assertEqual(worker.queue.qsize(), 1)
        self.assertIs(worker.queue.get_nowait()[0], active)
        worker.queue.task_done()
        await worker.queue.join()

    async def test_inflight_recognition_cannot_deliver_after_close(self):
        worker = object.__new__(Worker)
        worker.queue = asyncio.Queue(maxsize=24)
        worker.http = SimpleNamespace(post=AsyncMock())
        session = SimpleNamespace(closed=False, allowed={"m_speaker"}, job={}, partials={})
        # The inference runs on another thread. Retire the session before its
        # result comes back to the event loop.
        import threading
        started, release = threading.Event(), threading.Event()

        def recognize(pcm, language, final):
            started.set()
            release.wait(timeout=2)
            return "Private speech", "en"

        worker.recognize = recognize
        worker.queue.put_nowait((session, "m_speaker", Chunk("utterance", b"pcm", 0, 1000, True)))
        task = asyncio.create_task(worker.infer())
        try:
            await asyncio.to_thread(started.wait, 2)
            self.assertTrue(started.is_set())
            session.closed = True
            release.set()
            await asyncio.wait_for(worker.queue.join(), 3)
            worker.http.post.assert_not_awaited()
            self.assertEqual(session.partials, {})

            # Waiting for another utterance must not retain the previous PCM,
            # session, payload or decoded private text in coroutine locals.
            locals_ = task.get_coro().cr_frame.f_locals
            self.assertIsNone(locals_["chunk"])
            self.assertIsNone(locals_["session"])
            self.assertEqual(locals_["text"], "")
        finally:
            release.set()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def test_recognition_pins_french_and_never_uses_translation(self):
        worker = object.__new__(Worker)
        model = SimpleNamespace(transcribe=Mock(return_value=(iter([SimpleNamespace(text="Bonjour à tous.", no_speech_prob=0.8)]), SimpleNamespace(language="fr"))))
        worker.model = model
        text, language = worker.recognize(bytes(3200), "fr", True)
        self.assertEqual((text, language), ("Bonjour à tous.", "fr"))
        options = model.transcribe.call_args.kwargs
        self.assertEqual(options["language"], "fr")
        self.assertEqual(options["task"], "transcribe")
        self.assertEqual(options["beam_size"], 5)
        self.assertEqual(options["temperature"], 0.0)

        self.assertEqual(options["no_speech_threshold"], 0.6)
        self.assertEqual(options["log_prob_threshold"], -1.0)

        self.assertTrue(options["vad_filter"])
        self.assertEqual(options["vad_parameters"]["min_speech_duration_ms"], 200)

    def test_auto_detection_requires_explicit_auto_choice(self):
        worker = object.__new__(Worker)
        worker.model = SimpleNamespace(transcribe=Mock(return_value=(iter([]), SimpleNamespace(language="en"))))
        worker.recognize(bytes(3200), "auto", False)
        self.assertIsNone(worker.model.transcribe.call_args.kwargs["language"])
        self.assertEqual(worker.model.transcribe.call_args.kwargs["beam_size"], 1)

    def test_caption_boilerplate_filter_is_narrow(self):
        for text in ["Sous-titres réalisés par la communauté d'Amara.org", "Sous-titres réalisés par la communauté d’Amara.org.", "Subtitles by the Amara.org community"]:
            self.assertTrue(subtitle_artifact(text))
        self.assertFalse(subtitle_artifact("Je parle du site Amara.org et de ses sous-titres."))
        self.assertFalse(subtitle_artifact("Il a dit : Sous-titres réalisés par la communauté d'Amara.org"))

    def test_newer_chunk_supersedes_pending_drafts(self):
        worker = object.__new__(Worker)
        worker.queue = asyncio.Queue(maxsize=24)
        session = object()
        worker.enqueue(session, "m_speaker", Chunk("utt", b"draft1", 0, 1600, False))
        worker.enqueue(session, "m_speaker", Chunk("utt", b"draft2", 0, 4800, False))
        worker.enqueue(session, "m_speaker", Chunk("utt", b"final", 0, 6000, True))
        self.assertEqual(worker.queue.qsize(), 1)
        self.assertTrue(worker.queue.get_nowait()[2].final)
        worker.queue.task_done()
        self.assertEqual(worker.queue._unfinished_tasks, 0)

    async def test_rejected_final_withdraws_instead_of_repeating_a_draft(self):
        worker = object.__new__(Worker)
        worker.queue = asyncio.Queue(maxsize=24)
        worker.http = SimpleNamespace(post=AsyncMock(return_value=SimpleNamespace(status_code=204)))
        worker.recognize = Mock(side_effect=[("Provisional text", "fr"), ("", "fr")])
        session = SimpleNamespace(closed=False, allowed={"m_speaker"}, job={"roomId": "room", "voiceRoomId": "physical", "generation": 0, "language": "fr"}, partials={})
        worker.queue.put_nowait((session, "m_speaker", Chunk("utt", b"draft", 0, 1600, False)))
        worker.queue.put_nowait((session, "m_speaker", Chunk("utt", b"final", 0, 6000, True)))
        task = asyncio.create_task(worker.infer())
        try:
            await asyncio.wait_for(worker.queue.join(), 3)
            final = worker.http.post.call_args.kwargs["json"]
            self.assertEqual(final["text"], "")
            self.assertTrue(final["discarded"])
            self.assertTrue(final["final"])
            self.assertEqual(session.partials, {})
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


if __name__ == "__main__":
    unittest.main()
