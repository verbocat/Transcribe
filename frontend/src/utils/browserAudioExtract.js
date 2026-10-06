/**
 * Extract the audio track of a (large) video ON THIS COMPUTER with FFmpeg compiled to WebAssembly.
 *
 * Why: the server only ever needs the audio. Uploading a 765 MB video just so the server can run
 * FFmpeg costs minutes; the 16 kHz mono WAV inside it is ~2 MB per minute. The video file is read
 * straight from disk (WORKERFS mounts the File without copying it into memory).
 *
 * The FFmpeg arguments are identical to the server's (backend/app/video_processor.py), so the WAV
 * is the same audio the server would have produced.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { computeWaveformPeaks } from './audioExtractor';

const CORE_BASE = '/ffmpeg';
let ffmpegPromise = null;

export function browserExtractionSupported() {
  return typeof WebAssembly === 'object' && typeof Worker === 'function' && typeof File === 'function';
}

async function loadEngine(onProgress) {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    const ffmpeg = new FFmpeg();
    onProgress?.({ stage: 'engine', percent: 0, loaded: 0, total: 0, detail: 'Loading the audio engine (one-time download)' });
    const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm', true, ({ total, received, done }) => {
      if (done) return;
      onProgress?.({
        stage: 'engine',
        percent: total > 0 ? (received / total) * 100 : null,
        loaded: received,
        total,
        detail: 'Loading the audio engine (one-time download)',
      });
    });
    await ffmpeg.load({ coreURL, wasmURL });
    return ffmpeg;
  })().catch((err) => {
    ffmpegPromise = null; // allow a retry next time
    throw err;
  });
  return ffmpegPromise;
}

/** Find the PCM payload of a RIFF/WAVE file (ffmpeg adds a LIST chunk, so the data chunk is not at byte 44). */
function wavDataRegion(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  while (off + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') return { start: off + 8, length: Math.min(size, bytes.byteLength - off - 8) };
    off += 8 + size + (size % 2);
  }
  throw new Error('The extracted WAV has no audio data.');
}

/**
 * Returns the same shape as the server path in extractAudioFromMedia().
 * onProgress receives { stage, percent, loaded?, total?, detail } with measured values only.
 */
export async function extractAudioInBrowser(file, onProgress) {
  const ffmpeg = await loadEngine(onProgress);

  const ext = (file.name.match(/\.[A-Za-z0-9]{1,5}$/) || ['.bin'])[0].toLowerCase();
  const inputName = `input${ext}`;
  const mountDir = '/media';
  const outName = 'audio_16k.wav';

  let lastPct = 0;
  const onFFmpegProgress = ({ progress, time }) => {
    // ffmpeg.wasm derives `progress` (0..1) from the duration it reads out of the container
    if (!Number.isFinite(progress) || progress < 0) return;
    lastPct = Math.max(lastPct, Math.min(99, progress * 100));
    const secs = Number.isFinite(time) ? Math.max(0, Math.round(time / 1e6)) : null;
    onProgress?.({
      stage: 'local',
      percent: lastPct,
      detail: secs != null
        ? `Extracting the audio on this computer: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} of the video processed`
        : 'Extracting the audio on this computer',
    });
  };

  onProgress?.({ stage: 'local', percent: 0, detail: 'Extracting the audio on this computer' });
  ffmpeg.on('progress', onFFmpegProgress);
  try {
    try { await ffmpeg.createDir(mountDir); } catch (_) { /* already exists */ }
    await ffmpeg.mount('WORKERFS', { files: [new File([file], inputName)] }, mountDir);
    // Same arguments as the server: drop video, 16-bit PCM, 16 kHz, mono
    const code = await ffmpeg.exec(['-i', `${mountDir}/${inputName}`, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', outName]);
    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);

    const data = await ffmpeg.readFile(outName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const { start, length } = wavDataRegion(bytes);
    const sampleRate = 16000;
    const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + start + (length - (length % 2))));
    const duration = samples.length / sampleRate;
    if (!(duration > 0)) throw new Error('No audio was found in this file.');

    // Instant waveform for the timeline (display only; the server computes its own authoritative peaks)
    const peaks = computeWaveformPeaks(samples, duration, 50, 1 / 32768);

    const stem = (file.name || 'audio').replace(/\.[^/.]+$/, '').replace(/[^\w.-]/g, '_');
    const audioBlob = new Blob([bytes], { type: 'audio/wav' });
    const audioFile = new File([audioBlob], `${stem}_audio.wav`, { type: 'audio/wav' });
    onProgress?.({ stage: 'local', percent: 100, detail: 'Audio extracted' });

    return {
      audioBlob,
      audioFile,
      peaks,
      duration,
      sampleRate,
      audioUrl: URL.createObjectURL(audioBlob),
    };
  } finally {
    ffmpeg.off('progress', onFFmpegProgress);
    try { await ffmpeg.deleteFile(outName); } catch (_) { /* nothing to delete */ }
    try { await ffmpeg.unmount(mountDir); } catch (_) { /* not mounted */ }
  }
}
