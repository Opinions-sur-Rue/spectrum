import unittest

from load_test import Job, JobBuffer, distribution, fixture_chunks


class LoadTests(unittest.TestCase):
    def test_fixture_reproduces_drafts_and_final_silence(self):
        chunks, cycle = fixture_chunks(bytes(32000 * 5))
        self.assertEqual([(time, final) for time, final, _ in chunks], [(1.6, False), (4.8, False), (5.8, True)])
        self.assertEqual(cycle, 5.8)
        self.assertTrue(all(wav.startswith(b"RIFF") for _, _, wav in chunks))

    def test_newer_final_supersedes_draft_but_not_other_speakers(self):
        queue = JobBuffer()
        queue.submit(Job(1, 0, 0, False, b"draft"))
        queue.submit(Job(2, 0, 0, False, b"other"))
        queue.submit(Job(1, 0, 0, True, b"final"))
        queue.close()
        self.assertEqual(queue.take().wav, b"other")
        self.assertEqual(queue.take().wav, b"final")
        self.assertIsNone(queue.take())
        self.assertEqual(queue.counts["superseded_drafts"], 1)

    def test_backlog_skips_drafts_and_bounds_finals(self):
        queue = JobBuffer(limit=2)
        for speaker in range(3):
            queue.submit(Job(speaker, 0, 0, True, b"final"))
        queue.submit(Job(4, 0, 0, False, b"draft"))
        self.assertEqual(len(queue.pending), 2)
        self.assertEqual(queue.counts["dropped_finals"], 1)
        self.assertEqual(queue.counts["skipped_drafts"], 1)

    def test_distribution_uses_nearest_rank_milliseconds(self):
        self.assertIsNone(distribution([]))
        self.assertEqual(distribution([.1, .3, .2]), {"p50_ms": 200, "p95_ms": 300, "max_ms": 300})


if __name__ == "__main__":
    unittest.main()
