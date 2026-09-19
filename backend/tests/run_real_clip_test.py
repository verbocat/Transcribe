import json
import os
import sys
from pathlib import Path
import soundfile as sf
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from app.audio_processor import snap_to_acoustic_boundaries, parse_timestamp
from app.gemini_subtitle_generator import polish_subtitle_events_netflix
from app.export_service import export_netflix_srt, export_netflix_vtt

def run_diagnostic():
    uploads_dir = Path(__file__).parent.parent / "uploads"
    wav_path = uploads_dir / "up_6k2nca80_Battleground_S2_Ep28_Tod_Dunga_Shiva_Ko_2_new_-_Copy_audio.wav"
    if not wav_path.exists():
        wav_path = uploads_dir / "temp_diagnostic_slice.wav"
    
    json_path = uploads_dir / "diagnostic_gemini_out.json"
    
    if not wav_path.exists() or not json_path.exists():
        print(f"ERROR: Audio or JSON not found in {uploads_dir}")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    raw_subs = data.get("subtitles", [])

    sr = 16000
    audio_samples, _ = sf.read(str(wav_path), frames=60 * sr)
    if audio_samples.ndim > 1:
        audio_samples = audio_samples.mean(axis=1)

    events = []
    for s in raw_subs:
        st = parse_timestamp(s["start_time"])
        et = parse_timestamp(s["end_time"])
        events.append({
            "id": s["id"],
            "start_time": st,
            "end_time": et,
            "text": s["text"],
            "speakers": s.get("speakers", ["Speaker 1"])
        })

    # Snap against real audio
    snapped = []
    for ev in events:
        s_time, e_time = snap_to_acoustic_boundaries(str(wav_path), ev["start_time"], ev["end_time"], collar_sec=0.80)
        snapped.append({
            "id": ev["id"],
            "start_time": s_time,
            "end_time": e_time,
            "text": ev["text"],
            "speakers": ev["speakers"]
        })

    polished = polish_subtitle_events_netflix(snapped, frame_rate=24.0, min_duration=0.60)

    print("\n" + "=" * 115)
    print("REAL BATTLEGROUND EPISODE: ACOUSTIC ENERGY VS DETECTED TIMESTAMPS REPORT")
    print(f"Source Audio: {wav_path.name}")
    print("=" * 115)
    print(f"{'ID':<3} | {'Raw TS':<15} | {'Snapped TS':<15} | {'Pre-RMS':<8} | {'Onset-RMS':<9} | {'Gain(dB)':<8} | {'Overlap?':<8} | {'Dialogue Text'}")
    print("-" * 115)

    overlaps_found = 0
    for i in range(len(polished)):
        cur = polished[i]
        st = cur["start_time"]
        et = cur["end_time"]

        idx_st = int(st * sr)
        pre_start_idx = max(0, idx_st - int(0.150 * sr))
        pre_window = audio_samples[pre_start_idx:idx_st]
        pre_rms = float(np.sqrt(np.mean(pre_window**2))) if len(pre_window) > 0 else 0.0001

        onset_end_idx = min(len(audio_samples), idx_st + int(0.150 * sr))
        onset_window = audio_samples[idx_st:onset_end_idx]
        onset_rms = float(np.sqrt(np.mean(onset_window**2))) if len(onset_window) > 0 else 0.0001

        gain_db = 20.0 * np.log10((onset_rms + 1e-6) / (pre_rms + 1e-6))

        has_overlap = False
        if i < len(polished) - 1:
            nxt = polished[i + 1]
            gap = nxt["start_time"] - cur["end_time"]
            if gap < 0.080:
                has_overlap = True
                overlaps_found += 1

        raw_str = f"{events[i]['start_time']:5.2f}s-{events[i]['end_time']:5.2f}s"
        snap_str = f"{cur['start_time']:5.2f}s-{cur['end_time']:5.2f}s"
        ov_flag = "COLLISION" if has_overlap else "CLEAN"
        snippet = cur["text"].replace("\n", " ")[:32]
        print(f"{cur['id']:<3} | {raw_str:<15} | {snap_str:<15} | {pre_rms:8.4f} | {onset_rms:9.4f} | {gain_db:7.1f}dB | {ov_flag:<8} | {snippet}")

    print("=" * 115)
    print(f"Summary: {len(polished)} subtitles processed | {overlaps_found} overlaps detected.")

    # Export
    srt_path = uploads_dir / "diagnostic_battleground_actual_sync.srt"
    vtt_path = uploads_dir / "diagnostic_battleground_actual_sync.vtt"
    srt_content = export_netflix_srt(polished)
    vtt_content = export_netflix_vtt(polished)
    srt_path.write_text(srt_content, encoding="utf-8")
    vtt_path.write_text(vtt_content, encoding="utf-8")
    print(f"\nGenerated verification files:")
    print(f"  SRT: {srt_path}")
    print(f"  VTT: {vtt_path}")
    print("\nHow to verify with your real video player:")
    print("  1. Open your Battleground episode video in VLC, PotPlayer, or Windows Media Player.")
    print(f"  2. Drag and drop '{srt_path.name}' directly onto the playing video.")
    print("  3. Observe that each Hindi subtitle lights up precisely as the speaker opens their mouth.")

if __name__ == "__main__":
    run_diagnostic()
