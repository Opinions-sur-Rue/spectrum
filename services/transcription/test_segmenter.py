import unittest
from segmenter import Segmenter, FRAME_BYTES, MAX_UTTERANCE_MS


class VAD:
    def is_speech(self, frame, rate):
        return frame[0] == 1


class SegmenterTests(unittest.TestCase):
    def test_silence_is_never_transcribed(self):
        segmenter = Segmenter(VAD(), 1000)
        for _ in range(1000):
            self.assertEqual(segmenter.feed(bytes(FRAME_BYTES)), [])
        self.assertLessEqual(len(segmenter.preroll), 10)

    def test_partial_and_final_share_id(self):
        segmenter = Segmenter(VAD(), 1000)
        chunks = []
        for _ in range(170):
            chunks += segmenter.feed(bytes([1]) * FRAME_BYTES)
        for _ in range(40):
            chunks += segmenter.feed(bytes(FRAME_BYTES))
        self.assertEqual([chunk.final for chunk in chunks], [False, True])
        self.assertEqual(chunks[0].id, chunks[1].id)
        self.assertEqual(chunks[1].start, 1000)
        self.assertEqual(chunks[1].end, 5200)

    def test_long_speech_is_bounded_without_four_second_cuts(self):
        segmenter = Segmenter(VAD(), 0)
        chunks = []
        for _ in range(1800):
            chunks += segmenter.feed(bytes([1]) * FRAME_BYTES)
        self.assertEqual(len([chunk for chunk in chunks if chunk.final]), 3)
        self.assertTrue(all(len(chunk.pcm) <= MAX_UTTERANCE_MS * 16000 * 2 // 1000 for chunk in chunks))

    def test_pause_does_not_cut_a_sentence_before_eight_seconds(self):
        segmenter = Segmenter(VAD(), 0)
        chunks = []
        for _ in range(250):
            chunks += segmenter.feed(bytes([1]) * FRAME_BYTES)
        for _ in range(20):
            chunks += segmenter.feed(bytes(FRAME_BYTES))
        self.assertFalse(any(chunk.final for chunk in chunks))
        for _ in range(200):
            chunks += segmenter.feed(bytes([1]) * FRAME_BYTES)
        for _ in range(10):
            chunks += segmenter.feed(bytes(FRAME_BYTES))
        self.assertTrue(chunks[-1].final)

    def test_first_draft_arrives_at_1600ms_then_refreshes_at_4800ms(self):
        segmenter = Segmenter(VAD(), 0)
        chunks = []
        for _ in range(250):
            chunks += segmenter.feed(bytes([1]) * FRAME_BYTES)
        self.assertEqual([chunk.end for chunk in chunks], [1600, 4800])
        self.assertEqual(chunks[0].id, chunks[1].id)


if __name__ == "__main__":
    unittest.main()
