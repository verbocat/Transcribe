import unittest
from app.dtw_aligner import align_events_dtw, token_distance, devanagari_to_roman

class TestDTWImprovements(unittest.TestCase):
    def test_devanagari_cross_script_matching(self):
        """Verify that Devanagari loan words match Latin Whisper words with high similarity."""
        # 'टारगेट' should romanize to 'target'
        rom = devanagari_to_roman("टारगेट")
        self.assertEqual(rom, "target")
        dist = token_distance("टारगेट", "target")
        self.assertEqual(dist, 0.0)

        # 'सॉरी' should match 'sorry' with dist < 0.60
        dist_sorry = token_distance("सॉरी", "sorry")
        self.assertLess(dist_sorry, 0.60)

        # 'भाई' should match 'bhai'
        dist_bhai = token_distance("भाई", "bhai")
        self.assertEqual(dist_bhai, 0.0)

    def test_head_tail_extrapolation(self):
        """Verify that missing edge words are extrapolated so subtitles don't start late or cut off."""
        # 5 words in Gemini event
        gemini_events = [{
            "id": 1,
            "text": "अरे भाई तू कहाँ गया",
            "start_time": 10.0,
            "end_time": 13.0
        }]
        # Whisper only heard words 2 and 3 ("तू", "कहाँ") from 11.0s to 12.0s
        whisper_words = [
            {"word": "tu", "start": 11.0, "end": 11.5, "probability": 0.95},
            {"word": "kahan", "start": 11.5, "end": 12.0, "probability": 0.95}
        ]
        results = align_events_dtw(gemini_events, whisper_words, min_confidence=0.40)
        self.assertEqual(len(results), 1)
        res = results[0]
        # Start time must be extrapolated earlier than 11.0s to cover "अरे", "भाई"
        self.assertLess(res["matched_start"], 11.0)
        # End time must be extrapolated past 12.0s to cover "गया"
        self.assertGreater(res["matched_end"], 12.0)

    def test_outlier_rejection(self):
        """Verify that rogue words 10 seconds away are rejected as outliers."""
        gemini_events = [{
            "id": 1,
            "text": "तू वहाँ जा",
            "start_time": 5.0,
            "end_time": 7.0
        }]
        # Words 1 and 2 at 5.2s-6.0s, and a rogue word at 25.0s
        whisper_words = [
            {"word": "tu", "start": 5.2, "end": 5.6, "probability": 0.9},
            {"word": "vahan", "start": 5.7, "end": 6.1, "probability": 0.9},
            {"word": "ja", "start": 25.0, "end": 25.5, "probability": 0.9}
        ]
        results = align_events_dtw(gemini_events, whisper_words, min_confidence=0.40)
        self.assertEqual(len(results), 1)
        res = results[0]
        # End time must NOT balloon to 25.0s!
        self.assertLess(res["matched_end"], 10.0)

if __name__ == "__main__":
    unittest.main()
