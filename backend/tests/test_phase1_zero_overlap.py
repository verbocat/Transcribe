import unittest
from app.netflix_linter import auto_chain_gaps
from app.gemini_subtitle_generator import stitch_cross_chunk_seam, polish_subtitle_events_netflix

class TestZeroOverlapEnforcement(unittest.TestCase):
    def test_two_overlapping_subtitles(self):
        """Test that 2 overlapping subtitles are cleanly clamped with min_gap."""
        events = [
            {"id": 1, "start_time": 10.0, "end_time": 13.5, "text": "First speaker line"},
            {"id": 2, "start_time": 12.0, "end_time": 15.0, "text": "Second speaker interrupting"}
        ]
        res = auto_chain_gaps(events, frame_rate=24.0, min_duration=0.5)
        self.assertEqual(len(res), 2)
        # Event 1 end_time must be <= Event 2 start_time - 2 frames (0.083s)
        self.assertLessEqual(res[0]["end_time"], res[1]["start_time"] - 0.08)
        self.assertGreater(res[0]["duration"], 0.1)
        self.assertGreater(res[1]["duration"], 0.1)

    def test_three_overlapping_subtitles(self):
        """Test the exact scenario reported by user: 3 subtitles overlapping at the same second."""
        events = [
            {"id": 1, "start_time": 10.0, "end_time": 14.0, "text": "Line one"},
            {"id": 2, "start_time": 11.2, "end_time": 13.8, "text": "Line two overlapping"},
            {"id": 3, "start_time": 12.5, "end_time": 15.5, "text": "Line three overlapping"}
        ]
        res = auto_chain_gaps(events, frame_rate=24.0, min_duration=0.5)
        self.assertEqual(len(res), 3)
        # Verify strictly monotonic non-overlapping order across all 3
        for i in range(len(res) - 1):
            self.assertLessEqual(res[i]["end_time"], res[i+1]["start_time"] - 0.08,
                                 f"Event {i} and {i+1} still overlap: {res[i]['end_time']} vs {res[i+1]['start_time']}")
            self.assertGreater(res[i]["duration"], 0.1)

    def test_inverted_start_times(self):
        """Test that subtitles provided out of chronological order are sorted and sequenced."""
        events = [
            {"id": 1, "start_time": 12.0, "end_time": 14.0, "text": "Later line"},
            {"id": 2, "start_time": 10.0, "end_time": 12.5, "text": "Earlier line"}
        ]
        res = auto_chain_gaps(events, frame_rate=24.0, min_duration=0.5)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]["text"], "Earlier line")
        self.assertEqual(res[1]["text"], "Later line")
        self.assertLessEqual(res[0]["end_time"], res[1]["start_time"] - 0.08)

    def test_cross_chunk_seam_cascade(self):
        """Test that seam stitching pushes subsequent events in current batch to prevent 3-subtitle overlap."""
        prev_events = [
            {"id": 10, "start_time": 88.0, "end_time": 91.5, "text": "End of chunk 1"}
        ]
        curr_events = [
            {"id": 1, "start_time": 90.5, "end_time": 92.5, "text": "Start of chunk 2 colliding"},
            {"id": 2, "start_time": 91.0, "end_time": 93.0, "text": "Second event in chunk 2"},
            {"id": 3, "start_time": 92.0, "end_time": 94.0, "text": "Third event in chunk 2"}
        ]
        p_res, c_res = stitch_cross_chunk_seam(prev_events, curr_events, min_gap_sec=0.083, min_duration=0.5)
        self.assertGreaterEqual(c_res[0]["start_time"], p_res[-1]["end_time"] + 0.08)
        # Verify subsequent events in chunk 2 are properly cascaded forward
        for k in range(len(c_res) - 1):
            self.assertLessEqual(c_res[k]["end_time"], c_res[k+1]["start_time"] - 0.08,
                                 f"Chunk 2 events {k} and {k+1} overlap: {c_res[k]['end_time']} vs {c_res[k+1]['start_time']}")

    def test_export_safety_clamp(self):
        """Test that export functions safely clamp overlapping events."""
        from app.export_service import export_netflix_srt, export_netflix_vtt
        events = [
            {"id": 1, "start_time": 2.0, "end_time": 5.0, "text": "Overlapping cue 1"},
            {"id": 2, "start_time": 4.5, "end_time": 7.0, "text": "Overlapping cue 2"}
        ]
        srt_out = export_netflix_srt(events)
        # Event 1 end time in SRT should be <= 00:00:04,460 (clamped before 4.5)
        self.assertIn("00:00:02,000 --> 00:00:04,460", srt_out)
        self.assertIn("00:00:04,500 --> 00:00:07,000", srt_out)

    def test_autofix_shot_snap_zero_overlap(self):
        """Test that auto_fix_subtitles maintains zero overlap even when shot changes are snapped."""
        from app.netflix_linter import auto_fix_subtitles
        events = [
            {"id": 1, "start_time": 1.0, "end_time": 2.0, "text": "Line one"},
            {"id": 2, "start_time": 2.2, "end_time": 3.5, "text": "Line two"}
        ]
        # Shot change right at 2.15s (between event 1 and event 2)
        res = auto_fix_subtitles(events, shot_changes=[2.15], frame_rate=24.0)
        # Ensure Event 1 and Event 2 maintain required min gap
        self.assertLessEqual(res[0]["end_time"], res[1]["start_time"] - 0.08)

if __name__ == "__main__":
    unittest.main()
