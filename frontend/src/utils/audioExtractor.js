/**
 * Browser-Side Audio Extractor & Instant Waveform Generator
 * Demuxes audio from video/audio files in the browser using the Web Audio API,
 * downsamples to clean 16kHz or 12kHz mono PCM, encodes into a small WAV Blob,
 * and extracts acoustic waveform peaks in under 1 second.
 */

export function computeWaveformPeaks(channelData, duration, pps = 50, scale = 1) {
  const totalPoints = Math.max(1, Math.floor(duration * pps));
  const blockSize = Math.max(1, Math.floor(channelData.length / totalPoints));
  const peaks = new Float32Array(totalPoints);

  for (let i = 0; i < totalPoints; i++) {
    const start = i * blockSize;
    let maxVal = 0;
    let sumSq = 0;
    const step = Math.max(1, Math.floor(blockSize / 32));
    let count = 0;
    for (let j = 0; j < blockSize && start + j < channelData.length; j += step) {
      const val = Math.abs(channelData[start + j]) * scale;
      if (val > maxVal) maxVal = val;
      sumSq += val * val;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    peaks[i] = 0.6 * maxVal + 0.4 * (rms * 2.5);
  }

  let maxObserved = 0.01;
  for (let i = 0; i < totalPoints; i++) {
    if (peaks[i] > maxObserved) maxObserved = peaks[i];
  }
  const norm = maxObserved > 1e-4 ? maxObserved : 1.0;
  const normalized = [];
  for (let i = 0; i < totalPoints; i++) {
    normalized.push(Math.round(Math.max(0.02, Math.min(1.0, peaks[i] / norm)) * 10000) / 10000);
  }
  return normalized;
}

export function encodeWAV(samples, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels (1 for mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate
  view.setUint16(32, numChannels * bytesPerSample, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample (16)

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // 16-bit signed PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

import { xhrPostForm, fetchBlobWithProgress, createRateMeter } from './xhrUpload';
import { CancelledError, cancelServerJob, isCancelError, jobHeaders, sleepCancellable } from './cancellable';

export async function extractAudioFromMedia(file, onProgress, apiBase = '', { preferLocal = true, signal, job } = {}) {
  if (signal?.aborted) throw new CancelledError();
  const isVideo = Boolean(
    file.type?.startsWith('video/') ||
    /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i.test(file.name || '')
  );

  const isWma = Boolean(
    file.type === 'audio/x-ms-wma' ||
    file.type === 'audio/wma' ||
    /\.(wma)$/i.test(file.name || '')
  );

  // If file is a standard browser-supported audio file (and NOT WMA), attempt instant browser Web Audio API decoding first
  if (!isVideo && !isWma) {
    try {
      if (onProgress) onProgress({ stage: 'decode', percent: null, detail: 'Reading the audio file' });
      const arrayBuffer = await file.arrayBuffer();

      if (onProgress) onProgress({ stage: 'decode', percent: null, detail: 'Decoding the audio in your browser' });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();

      let audioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      } finally {
        audioCtx.close().catch(() => {});
      }
      if (signal?.aborted) throw new CancelledError();

      if (onProgress) onProgress({ stage: 'decode', percent: null, detail: 'Mixing down to mono' });
      const duration = audioBuffer.duration;
      
      // Downmix to mono
      const numChannels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;
      let monoChannel;
      if (numChannels === 1) {
        monoChannel = audioBuffer.getChannelData(0);
      } else {
        monoChannel = new Float32Array(length);
        const ch0 = audioBuffer.getChannelData(0);
        const ch1 = audioBuffer.getChannelData(1);
        for (let i = 0; i < length; i++) {
          monoChannel[i] = 0.5 * (ch0[i] + ch1[i]);
        }
      }

      const peaks = computeWaveformPeaks(monoChannel, duration, 50);

      if (onProgress) onProgress({ stage: 'decode', percent: null, detail: 'Encoding a clean WAV for upload' });
      const targetSampleRate = duration > 2400 ? 12000 : 16000;
      const srcSampleRate = audioBuffer.sampleRate;

      let finalSamples;
      if (srcSampleRate === targetSampleRate) {
        finalSamples = monoChannel;
      } else {
        const ratio = srcSampleRate / targetSampleRate;
        const targetLength = Math.round(length / ratio);
        finalSamples = new Float32Array(targetLength);
        for (let i = 0; i < targetLength; i++) {
          const srcIdx = Math.floor(i * ratio);
          finalSamples[i] = monoChannel[srcIdx];
        }
      }

      const wavBlob = encodeWAV(finalSamples, targetSampleRate);
      const stem = (file.name || 'audio').replace(/\.[^/.]+$/, '');
      const cleanStem = stem.replace(/[^\w\.-]/g, '_');
      const audioFile = new File([wavBlob], `${cleanStem}_audio.wav`, { type: 'audio/wav' });

      return {
        audioBlob: wavBlob,
        audioFile: audioFile,
        peaks: peaks,
        duration: duration,
        sampleRate: targetSampleRate
      };
    } catch (browserDecodeErr) {
      if (signal?.aborted) throw new CancelledError();
      console.warn("Client Web Audio decode fallback to server FFmpeg:", browserDecodeErr);
    }
  }

  // Preferred for video: extract the audio on THIS computer (WebAssembly FFmpeg) so only ~2 MB per
  // minute of audio is uploaded instead of the whole video. Falls back to the server on any problem.
  if (preferLocal) {
    try {
      const { extractAudioInBrowser, browserExtractionSupported } = await import('./browserAudioExtract');
      if (browserExtractionSupported()) {
        return await extractAudioInBrowser(file, onProgress, signal);
      }
    } catch (localErr) {
      if (isCancelError(localErr)) throw localErr;
      console.warn('Browser audio extraction unavailable, using the server instead:', localErr);
    }
  }

  // Server-side extraction with FFmpeg (video files and codecs the browser cannot decode).
  // Every number reported below is measured: bytes sent, FFmpeg's own media-time counter, bytes received.
  const base = apiBase || (window.location.port === '5173' ? 'http://localhost:8000' : '');
  const emit = (p) => { if (onProgress) onProgress(p); };
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  // 1. Upload the media file (real bytes)
  const formData = new FormData();
  formData.append('file', file);
  emit({ stage: 'upload', percent: 0, loaded: 0, total: file.size, detail: 'Uploading the video to the server' });
  const meter = createRateMeter();
  let up = await xhrPostForm(`${base}/api/audio/extract_async`, formData, {
    meter,
    signal,
    onProgress: (p) => emit({ stage: 'upload', detail: 'Uploading the video to the server', ...p }),
    onSent: () => emit({ stage: 'saving', percent: null, detail: 'Upload complete. The server is saving the file' }),
  });

  let data;
  if (up.status === 404 || up.status === 405) {
    // Older server without live progress: use the one-shot endpoint (stage is shown, percent is not invented)
    emit({ stage: 'extract', percent: null, detail: 'The server is extracting the audio (this server cannot report progress)' });
    const fd2 = new FormData();
    fd2.append('file', file);
    const legacy = await xhrPostForm(`${base}/api/audio/extract`, fd2, { signal, headers: jobHeaders(job) });
    if (!legacy.ok) throw new Error(`Server audio extraction failed: ${legacy.data?.detail || legacy.text || legacy.status}`);
    data = legacy.data;
  } else {
    if (!up.ok || !up.data?.job_id) {
      throw new Error(`Server audio extraction failed: ${up.data?.detail || (up.status === 413 ? 'the file is larger than the server allows' : `status ${up.status}`)}`);
    }

    // 2. Follow the FFmpeg job (real media-time progress)
    const jobId = up.data.job_id;
    const started = Date.now();
    // Cancelling now must also stop FFmpeg on the server, which runs under its own job id
    const stopServer = () => cancelServerJob(base, jobId);
    signal?.addEventListener('abort', stopServer, { once: true });
    for (;;) {
      await sleepCancellable(600, signal);
      const res = await fetch(`${base}/api/audio/extract_status/${jobId}`, { signal });
      if (res.status === 404) throw new Error('The server restarted while extracting. Please open the file again.');
      const st = await res.json();
      if (st.stage === 'cancelled') throw new CancelledError();
      if (st.stage === 'error') throw new Error(st.error || 'Audio extraction failed.');
      if (st.stage === 'done') { data = st.result; signal?.removeEventListener('abort', stopServer); break; }
      if (st.stage === 'waveform') {
        emit({ stage: 'waveform', percent: null, detail: 'Drawing the waveform' });
      } else {
        const have = Number.isFinite(st.seconds_total) && st.seconds_total > 0;
        emit({
          stage: 'extract',
          percent: st.percent ?? null,
          detail: have
            ? `Extracting audio with FFmpeg: ${mmss(st.seconds_done || 0)} of ${mmss(st.seconds_total)} processed`
            : 'Extracting audio with FFmpeg',
        });
      }
      if (Date.now() - started > 3 * 3600 * 1000) throw new Error('Audio extraction took too long.');
    }
  }

  // 3. Bring the extracted audio back (real bytes)
  emit({ stage: 'download', percent: 0, loaded: 0, total: data.audio_bytes || 0, detail: 'Downloading the extracted audio' });
  const audioBlob = await fetchBlobWithProgress(`${base}${data.audio_url}`, {
    expectedBytes: data.audio_bytes || 0,
    signal,
    onProgress: (p) => emit({ stage: 'download', detail: 'Downloading the extracted audio', ...p }),
  });
  const audioFile = new File([audioBlob], data.audio_filename, { type: 'audio/wav' });

  return {
    audioBlob: audioBlob,
    audioFile: audioFile,
    peaks: data.peaks || [],
    duration: data.duration || 0,
    sampleRate: data.sample_rate || 16000,
    audioUrl: `${base}${data.audio_url}`
  };
}
