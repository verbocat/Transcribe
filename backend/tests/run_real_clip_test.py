import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.whisper_aligner import get_whisper_word_timestamps, extract_acoustic_timeline_anchors

wav_path = r"d:\Older-transcribe\Transcribe\backend\uploads\temp_chunk_6c861ed5_4.wav"
words = get_whisper_word_timestamps(wav_path, language="hi", model_name="tiny")
anchors = extract_acoustic_timeline_anchors(words)
print(f"Acoustic anchors extracted: {len(anchors)}")
for a in anchors[:15]:
    print(f"[{a['start']:5.2f} -> {a['end']:5.2f}]: {a['text']}")
