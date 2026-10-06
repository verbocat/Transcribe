"""
Tests for Dialogue Harmonizer, Acoustic Pause Dominance, and Indic Shield Semantic Splitting.
"""

import unittest
from app.dialogue_harmonizer import (
    harmonize_dialogue_turns,
    score_split_candidate,
    get_acoustic_gap_after_word,
    verify_word_integrity
)
from app.gemini_subtitle_generator import split_and_balance_event


class TestDialogueHarmonizerAndSplitting(unittest.TestCase):

    def test_user_edge_case_acoustic_pause_after_pr(self):
        """
        User Example:
        Speaker says: "Mea vahaa gaya thaa pr..." followed by a sigh/pause.
        Verifies:
        1. "gaya thaa" is NEVER severed.
        2. The break occurs AFTER "pr..." matching the physical acoustic pause.
        """
        whisper_words = [
            {"word": "Mea", "start": 1.0, "end": 1.2},
            {"word": "vahaa", "start": 1.2, "end": 1.4},
            {"word": "gaya", "start": 1.4, "end": 1.7},
            {"word": "thaa", "start": 1.7, "end": 2.0},
            {"word": "pr...", "start": 2.0, "end": 2.3},
            # 600ms acoustic pause / sigh here!
            {"word": "lekin", "start": 2.9, "end": 3.2},
            {"word": "wahan", "start": 3.2, "end": 3.5},
            {"word": "koi", "start": 3.5, "end": 3.7},
            {"word": "nahi", "start": 3.7, "end": 4.0},
            {"word": "mila", "start": 4.0, "end": 4.4},
            {"word": "aur", "start": 4.4, "end": 4.6},
            {"word": "sab", "start": 4.6, "end": 4.8},
            {"word": "kuch", "start": 4.8, "end": 5.0},
            {"word": "khatam", "start": 5.0, "end": 5.3},
            {"word": "ho", "start": 5.3, "end": 5.4},
            {"word": "gaya", "start": 5.4, "end": 5.6},
        ]

        event = {
            "text": "Mea vahaa gaya thaa pr... lekin wahan koi nahi mila aur sab kuch khatam ho gaya",
            "start_time": 1.0,
            "end_time": 5.6,
            "speakers": ["Speaker 1"]
        }

        # With CPL=40, this event must split
        splits = split_and_balance_event(
            event,
            cpl_limit=40,
            max_lines=2,
            whisper_words=whisper_words,
            frame_rate=24.0,
            min_duration=0.8
        )

        self.assertGreaterEqual(len(splits), 2)
        first_event_text = splits[0]["text"]

        # Assert: "gaya thaa pr..." stayed together in the first event!
        self.assertTrue("gaya thaa pr" in first_event_text)
        # Assert: "gaya" was not severed from "thaa"
        self.assertNotIn("Mea vahaa gaya\n", first_event_text)

        # Assert: First event ends at or around 2.3 (end of pr before pause), second starts at 2.9
        self.assertAlmostEqual(splits[0]["end_time"], 2.3, delta=0.1)
        self.assertAlmostEqual(splits[1]["start_time"], 2.9, delta=0.1)
        print("PASS: User edge case 'gaya thaa pr...' split cleanly at pause!")

    def test_multi_speaker_cross_bleed_repair_english(self):
        """
        User Example:
        Speaker 1 says: "I want to go there and enjoy"
        Speaker 2 says: "yeah it's a great place"
        If raw generation was:
        Ev 1: "I want to go there and"
        Ev 2: "enjoy yeah it's a great place"
        Harmonizer MUST pull 'enjoy' back to Speaker 1!
        """
        events = [
            {"text": "I want to go there and", "speakers": ["Speaker 1"], "start_time": 1.0, "end_time": 2.5},
            {"text": "enjoy yeah it's a great place", "speakers": ["Speaker 2"], "start_time": 2.6, "end_time": 4.5}
        ]

        repaired = harmonize_dialogue_turns(events)

        self.assertEqual(len(repaired), 2)
        self.assertEqual(repaired[0]["text"], "I want to go there and enjoy")
        self.assertEqual(repaired[1]["text"], "yeah it's a great place")
        print("PASS: Cross-speaker English bleed repaired: 'enjoy' moved back to Speaker 1!")

    def test_multi_speaker_cross_bleed_repair_hindi_verbs(self):
        """
        Hindi multi-speaker verbal complex repair:
        Ev 1: "मैं भी यही" (Speaker 1)
        Ev 2: "चाहता हूँ हाँ सही बात है" (Speaker 2)
        Harmonizer MUST pull 'चाहता हूँ' back to Speaker 1!
        """
        events = [
            {"text": "मैं भी यही", "speakers": ["Speaker 1"], "start_time": 1.0, "end_time": 2.0},
            {"text": "चाहता हूँ हाँ सही बात है", "speakers": ["Speaker 2"], "start_time": 2.1, "end_time": 3.8}
        ]

        repaired = harmonize_dialogue_turns(events)

        self.assertEqual(len(repaired), 2)
        self.assertEqual(repaired[0]["text"], "मैं भी यही चाहता हूँ")
        self.assertEqual(repaired[1]["text"], "हाँ सही बात है")
        print("PASS: Cross-speaker Hindi verb bleed repaired!")

    def test_indic_shield_protects_verbal_complex_in_continuous_speech(self):
        """
        In continuous speech (< 300ms gap), Indic Shield strictly forbids
        severing compound verbs like 'लेना चाहता हूँ' or 'कर रहा था'.
        """
        whisper_words = [
            {"word": "main", "start": 0.0, "end": 0.3},
            {"word": "wahan", "start": 0.35, "end": 0.6},
            {"word": "jakar", "start": 0.65, "end": 0.9},
            {"word": "anand", "start": 0.95, "end": 1.2},
            {"word": "lena", "start": 1.25, "end": 1.5},
            {"word": "chahta", "start": 1.55, "end": 1.8},
            {"word": "hoon", "start": 1.85, "end": 2.1},
            {"word": "aur", "start": 2.15, "end": 2.4},
            {"word": "sab", "start": 2.45, "end": 2.7},
            {"word": "theek", "start": 2.75, "end": 3.0},
            {"word": "hoga", "start": 3.05, "end": 3.3}
        ]

        event = {
            "text": "main wahan jakar anand lena chahta hoon aur sab theek hoga",
            "start_time": 0.0,
            "end_time": 3.3,
            "speakers": ["Speaker 1"]
        }

        # With CPL=25, split must happen
        splits = split_and_balance_event(
            event,
            cpl_limit=25,
            max_lines=2,
            whisper_words=whisper_words,
            frame_rate=24.0,
            min_duration=0.8
        )

        self.assertGreaterEqual(len(splits), 2)
        # Verify 'lena' and 'chahta hoon' are not severed
        joined_splits = [s["text"] for s in splits]
        for s in joined_splits:
            if "lena" in s:
                self.assertIn("chahta hoon", s, "Compound verb 'lena chahta hoon' must not be severed!")

        print("PASS: Indic Shield protected compound verbal complex in continuous speech!")

    def test_verbatim_word_integrity_guarantee(self):
        """
        Guarantees that 100% of spoken words are preserved verbatim across harmonization.
        """
        events = [
            {"text": "this is speaker one and", "speakers": ["Speaker 1"]},
            {"text": "done yes indeed", "speakers": ["Speaker 2"]}
        ]
        repaired = harmonize_dialogue_turns(events)
        self.assertTrue(verify_word_integrity(events, repaired))
        print("PASS: Word integrity 100% verified.")


if __name__ == "__main__":
    unittest.main()
