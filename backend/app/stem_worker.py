"""Runs Demucs on one audio file in its own process (so a crash or a big model never takes the API down).

    python -m app.stem_worker INPUT.wav OUT_DIR

Writes OUT_DIR/vocals.wav (speech) and OUT_DIR/background.wav (music and effects, everything that is not speech).
Prints "PROGRESS <0..1>" lines. Uses soundfile for audio files so it does not depend on torchaudio's codecs.
"""
import os
import sys
from pathlib import Path


def main(src: str, out: str) -> int:
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    torch.set_num_threads(int(os.getenv("DEMUCS_THREADS", str(max(1, (os.cpu_count() or 2) - 1)))))
    model = get_model(os.getenv("DEMUCS_MODEL", "htdemucs"))
    model.eval()
    data, sr = sf.read(src, dtype="float32", always_2d=True)  # (samples, channels)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    wav = torch.from_numpy(data.T.copy())
    if sr != model.samplerate:
        import torchaudio.functional as F
        wav = F.resample(wav, sr, model.samplerate)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)

    # Process in chunks so progress can be reported; chunks overlap and are cross-faded, so there are no seams.
    sr_m = model.samplerate
    chunk, overlap = 60 * sr_m, 2 * sr_m
    total = wav.shape[1]
    out_sources = torch.zeros(len(model.sources), 2, total)
    weight = torch.zeros(total)
    pos = 0
    while pos < total:
        end = min(total, pos + chunk + overlap)
        part = wav[:, pos:end]
        with torch.no_grad():
            res = apply_model(model, part[None], device="cpu", split=True, overlap=0.1, progress=False)[0]
        n = res.shape[-1]
        fade = torch.ones(n)
        if pos > 0:
            k = min(overlap, n)
            fade[:k] = torch.linspace(0, 1, k)
        if end < total:
            k = min(overlap, n)
            fade[-k:] = torch.minimum(fade[-k:], torch.linspace(1, 0, k))
        out_sources[:, :, pos:pos + n] += res * fade
        weight[pos:pos + n] += fade
        print(f"PROGRESS {min(1.0, end / total):.3f}", flush=True)
        if end >= total:
            break
        pos += chunk
    out_sources /= weight.clamp(min=1e-6)
    out_sources = out_sources * (ref.std() + 1e-8) + ref.mean()

    vi = model.sources.index("vocals")
    vocals = out_sources[vi]
    background = sum(out_sources[i] for i in range(len(model.sources)) if i != vi)
    Path(out).mkdir(parents=True, exist_ok=True)
    for name, t in (("vocals", vocals), ("background", background)):
        arr = t.numpy().T
        peak = float(np.max(np.abs(arr))) or 1.0
        if peak > 0.99:
            arr = arr * (0.99 / peak)
        sf.write(str(Path(out) / f"{name}.wav"), arr, sr_m, subtype="PCM_16")
    print("PROGRESS 1.000", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
