import json
import os
import sys
import unittest
import soundfile as sf
import numpy as np
from pathlib import Path

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from app.audio_processor import snap_to_acoustic_boundaries, parse_timestamp
from app.vad_processor import get_silero_model, is_vad_available, snap_timestamp_to_voice_vad
from app.netflix_linter import auto_chain_gaps, lint_all_subtitles
from app.gemini_subtitle_generator import polish_subtitle_events_netflix
from app.export_service import export_netflix_srt, export_netflix_vtt

class TestRealClipAudioSync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Locate the user's actual uploaded episode audio file
        uploads_dir = Path(__file__).parent.parent / "uploads"
        
        # Priority 1: The full uploaded Battleground episode WAV
        full_ep_path = uploads_dir / "up_6k2nca80_Battleground_S2_Ep28_Tod_Dunga_Shiva_Ko_2_new_-_Copy_audio.wav"
        slice_path = uploads_dir / "temp_diagnostic_slice.wav"
        
        if full_ep_path.exists():
            cls.wav_path = full_ep_path
            cls.is_full_episode = True
        elif slice_path.exists():
            cls.wav_path = slice_path
            cls.is_full_episode = False
        else:
            raise unittest.SkipTest(f"Neither real episode {full_ep_path} nor slice {slice_path} found")

        cls.json_path = uploads_dir / "diagnostic_gemini_out.json"
        if not cls.json_path.exists():
            raise unittest.SkipTest(f"Real Gemini output json {cls.json_path} not found")

        with open(cls.json_path, "r", encoding="utf-8") as f:
            cls.gemini_data = json.load(f)
        cls.raw_events = cls.gemini_data.get("subtitles", [])

    def test_real_audio_pipeline_with_energy_diagnostics(self):
        """
        Runs diagnostic slices of the actual uploaded episode (up_6k2nca80_Battleground..._audio.wav),
        snaps timestamps to acoustic boundaries using Silero VAD, computes audio energy (RMS & gain),
        verifies zero overlaps & zero missing lines, and exports a verified .srt for real video player playback.
        """
        # Read the first 60 seconds of raw audio samples directly from the actual episode file
        sample_rate = 16000
        max_samples = 60 * sample_rate
        audio_samples, sr = sf.read(str(self.wav_path), frames=max_samples)
        if audio_samples.ndim > 1:
            audio_samples = audio_samples.mean(axis=1)

        events = []
        for s in self.raw_events:
            st = parse_timestamp(s["start_time"])
            et = parse_timestamp(s["end_time"])
            events.append({
                "id": s["id"],
                "start_time": st,
                "end_time": et,
                "text": s["text"],
                "speakers": s.get("speakers", ["Speaker 1"]),
            })

        self.assertEqual(len(events), 17, "Expected 17 real subtitles in diagnostic clip")

        # 1. Snap each real event against the actual WAV file using Silero VAD with 0.80s collar
        snapped_events = []
        for ev in events:
            raw_st = ev["start_time"]
            raw_et = ev["end_time"]
            snapped_st, snapped_et = snap_to_acoustic_boundaries(
                str(self.wav_path), raw_st, raw_et, collar_sec=0.80
            )
            snapped_events.append({
                "id": ev["id"],
                "start_time": snapped_st,
                "end_time": snapped_et,
                "text": ev["text"],
                "speakers": ev["speakers"]
            })

        # 2. Run polish and non-overlap enforcement
        polished = polish_subtitle_events_netflix(snapped_events, frame_rate=24.0, min_duration=0.60)

        # 3. Print the comprehensive Acoustic Energy vs Timestamp Diagnostic Report
        print("\n" + "=" * 115)
        print("REAL BATTLEGROUND EPISODE: ACOUSTIC ENERGY VS DETECTED TIMESTAMPS REPORT")
        print(f"Source Audio: {self.wav_path.name}")
        print("=" * 115)
        print(f"{'ID':<3} | {'Raw TS':<15} | {'Snapped TS':<15} | {'Pre-RMS':<8} | {'Onset-RMS':<9} | {'Gain(dB)':<8} | {'Overlap?':<8} | {'Dialogue Text'}")
        print("-" * 115)

        overlaps_found = 0
        energy_diagnostics = []

        for i in range(len(polished)):
            cur = polished[i]
            st = cur["start_time"]
            et = cur["end_time"]

            # Calculate acoustic energy around the detected start timestamp
            idx_st = int(st * sr)
            idx_et = int(et * sr)

            # Pre-onset window (150ms immediately prior to start)
            pre_start_idx = max(0, idx_st - int(0.150 * sr))
            pre_window = audio_samples[pre_start_idx:idx_st]
            pre_rms = float(np.sqrt(np.mean(pre_window**2))) if len(pre_window) > 0 else 0.0001

            # Onset window (first 150ms of detected dialogue)
            onset_end_idx = min(len(audio_samples), idx_st + int(0.150 * sr))
            onset_window = audio_samples[idx_st:onset_end_idx]
            onset_rms = float(np.sqrt(np.mean(onset_window**2))) if len(onset_window) > 0 else 0.0001

            # Energy gain (vocal attack ratio in dB)
            gain_db = 20.0 * np.log10((onset_rms + 1e-6) / (pre_rms + 1e-6))

            # Overlap check with previous
            has_overlap = False
            if i < len(polished) - 1:
                nxt = polished[i + 1]
                gap = nxt["start_time"] - cur["end_time"]
                if gap < 0.080:  # Less than 2 frames @ 24fps
                    has_overlap = True
                    overlaps_found += 1

            raw_str = f"{events[i]['start_time']:5.2f}s-{events[i]['end_time']:5.2f}s"
            snap_str = f"{cur['start_time']:5.2f}s-{cur['end_time']:5.2f}s"
            ov_flag = "COLLISION" if has_overlap else "CLEAN"
            snippet = cur["text"].replace("\n", " ")[:32]

            print(f"{cur['id']:<3} | {raw_str:<15} | {snap_str:<15} | {pre_rms:8.4f} | {onset_rms:9.4f} | {gain_db:7.1f}dB | {ov_flag:<8} | {snippet}")

            energy_diagnostics.append({
                "id": cur["id"],
                "start_time": st,
                "end_time": et,
                "pre_rms": pre_rms,
                "onset_rms": onset_rms,
                "gain_db": gain_db,
                "text": cur["text"]
            })

        print("=" * 115)

        # 4. Generate actual verified .srt and .vtt files for real video player verification
        srt_path = Path(__file__).parent.parent / "uploads" / "diagnostic_battleground_actual_sync.srt"
        vtt_path = Path(__file__).parent.parent / "uploads" / "diagnostic_battleground_actual_sync.vtt"
        srt_content = export_netflix_srt(polished)
        vtt_content = export_netflix_vtt(polished)
        srt_path.write_text(srt_content, encoding="utf-8")
        vtt_path.write_text(vtt_content, encoding="utf-8")

        print(f"\nREAL VIDEO PLAYER VERIFICATION FILES GENERATED:")
        print(f"   SRT: {srt_path}")
        print(f"   VTT: {vtt_path}")
        print("   (Open this .srt in VLC, PotPlayer, or web player with your Battleground video to verify sync!)\n")

        # 5. Assertions on Real Audio Data
        # A. Zero missing subtitles: all 17 events exist
        self.assertEqual(len(polished), 17, "Subtitles went missing during real audio processing!")

        # B. Zero overlaps: strictly 0 collisions across the entire slice
        self.assertEqual(overlaps_found, 0, f"Found {overlaps_found} overlapping subtitles on real audio!")

        # C. All subtitles have positive valid duration
        for ev in polished:
            dur = ev["end_time"] - ev["start_time"]
            self.assertGreater(dur, 0.40, f"Subtitle {ev['id']} duration {dur:.2f}s is below minimum!")

        # D. Verified voice presence at onset: Onset RMS must be non-zero acoustic voice energy
        active_speech_lines = [diag for diag in energy_diagnostics if diag["onset_rms"] > 0.01]
        self.assertGreaterEqual(
            len(active_speech_lines), 14,
            "Acoustic onset was not properly aligned with speech energy!"
        )

        print("ALL REAL AUDIO CHECKS PASSED: Real Audio Slices, Accurate Onsets, Zero Overlaps, Zero Missing Lines!\n")

if __name__ == "__main__":
    unittest.main()
