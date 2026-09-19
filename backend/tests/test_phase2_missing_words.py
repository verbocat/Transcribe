import unittest
from app.gemini_subtitle_generator import merge_short_fragments, stitch_cross_chunk_seam

class TestPhase2MissingWords(unittest.TestCase):
    def test_short_conversational_quips_not_swallowed(self):
        """Verify that rapid 1-3 word dialogues and imperatives are preserved as distinct events."""
        events = [
            {"id": 1, "start_time": 10.0, "end_time": 12.0, "text": "मैंने सब कुछ देख लिया था", "speakers": ["Speaker 1"]},
            {"id": 2, "start_time": 12.1, "end_time": 12.6, "text": "तू सुन", "speakers": ["Speaker 1"]},
            {"id": 3, "start_time": 12.7, "end_time": 13.2, "text": "मत कर", "speakers": ["Speaker 1"]},
            {"id": 4, "start_time": 13.3, "end_time": 13.8, "text": "हाँ", "speakers": ["Speaker 1"]},
            {"id": 5, "start_time": 14.0, "end_time": 16.0, "text": "अब आगे क्या करना है", "speakers": ["Speaker 1"]}
        ]
        res = merge_short_fragments(events)
        # All 5 dialogues must be kept as separate events! None swallowed!
        self.assertEqual(len(res), 5)
        self.assertEqual(res[1]["text"], "तू सुन")
        self.assertEqual(res[2]["text"], "मत कर")
        self.assertEqual(res[3]["text"], "हाँ")

    def test_english_short_dialogues_not_swallowed(self):
        """Verify English rapid interjections ('Watch out', 'Leave it', 'Stop') are kept independent."""
        events = [
            {"id": 1, "start_time": 1.0, "end_time": 2.5, "text": "We need to get out of here", "speakers": ["Speaker 1"]},
            {"id": 2, "start_time": 2.6, "end_time": 3.0, "text": "Watch out", "speakers": ["Speaker 1"]},
            {"id": 3, "start_time": 3.1, "end_time": 3.5, "text": "Leave it", "speakers": ["Speaker 1"]}
        ]
        res = merge_short_fragments(events)
        self.assertEqual(len(res), 3)
        self.assertEqual(res[1]["text"], "Watch out")
        self.assertEqual(res[2]["text"], "Leave it")

    def test_terminal_punctuation_prevents_merge(self):
        """Verify that sentences ending in terminal punctuation are NEVER merged, even with tiny gap."""
        events = [
            {"id": 1, "start_time": 1.0, "end_time": 2.0, "text": "क्या तुम आ रहे हो?", "speakers": ["Speaker 1"]},
            {"id": 2, "start_time": 2.08, "end_time": 2.5, "text": "नहीं।", "speakers": ["Speaker 1"]}
        ]
        res = merge_short_fragments(events)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]["text"], "क्या तुम आ रहे हो?")
        self.assertEqual(res[1]["text"], "नहीं।")

    def test_repeated_words_across_seam_not_popped(self):
        """Verify that identical repeated words across chunk seams are NOT falsely popped when spoken consecutively."""
        prev_events = [
            {"id": 1, "start_time": 88.0, "end_time": 88.8, "text": "हाँ", "speakers": ["Speaker 1"]}
        ]
        curr_events = [
            {"id": 2, "start_time": 89.0, "end_time": 89.6, "text": "हाँ", "speakers": ["Speaker 2"]},
            {"id": 3, "start_time": 89.8, "end_time": 92.0, "text": "मैं भी यही बोल रहा था", "speakers": ["Speaker 2"]}
        ]
        p_res, c_res = stitch_cross_chunk_seam(prev_events, curr_events, collar_sec=2.0)
        # Event 2 must NOT be popped because c_start (89.0) >= p_end (88.8) - 0.05
        self.assertEqual(len(c_res), 2)
        self.assertEqual(c_res[0]["text"], "हाँ")
        self.assertEqual(c_res[1]["text"], "मैं भी यही बोल रहा था")

    def test_true_collar_duplicates_are_safely_popped(self):
        """Verify that true acoustic collar duplicates (overlapping sound range) ARE popped."""
        prev_events = [
            {"id": 1, "start_time": 88.0, "end_time": 90.5, "text": "We have to go now", "speakers": ["Speaker 1"]}
        ]
        curr_events = [
            {"id": 2, "start_time": 88.2, "end_time": 90.6, "text": "We have to go now", "speakers": ["Speaker 1"]},
            {"id": 3, "start_time": 91.0, "end_time": 93.0, "text": "The train is leaving", "speakers": ["Speaker 1"]}
        ]
        p_res, c_res = stitch_cross_chunk_seam(prev_events, curr_events, collar_sec=2.0)
        # Event 2 was an overlap collar re-transcription and must be cleanly popped
        self.assertEqual(len(c_res), 1)
        self.assertEqual(c_res[0]["text"], "The train is leaving")

    def test_sentence_extension_across_seam_merges(self):
        """Verify that a sentence cut off at chunk boundary seamlessly merges with its completion in the next chunk."""
        prev_events = [
            {"id": 1, "start_time": 88.0, "end_time": 90.0, "text": "We must go to the", "speakers": ["Speaker 1"]}
        ]
        curr_events = [
            {"id": 2, "start_time": 88.0, "end_time": 91.5, "text": "We must go to the market now", "speakers": ["Speaker 1"]},
            {"id": 3, "start_time": 92.0, "end_time": 94.0, "text": "Before it closes", "speakers": ["Speaker 1"]}
        ]
        p_res, c_res = stitch_cross_chunk_seam(prev_events, curr_events, collar_sec=2.0)
        # Prev event updated with full sentence, curr event 0 popped
        self.assertEqual(p_res[0]["text"], "We must go to the market now")
        self.assertEqual(p_res[0]["end_time"], 91.5)
        self.assertEqual(len(c_res), 1)
        self.assertEqual(c_res[0]["text"], "Before it closes")

if __name__ == "__main__":
    unittest.main()
