/**
 * Browser-Side Audio Extractor & Instant Waveform Generator
 * Demuxes audio from video/audio files in the browser using the Web Audio API,
 * downsamples to clean 16kHz or 12kHz mono PCM, encodes into a small WAV Blob,
 * and extracts acoustic waveform peaks in under 1 second.
 */

export function computeWaveformPeaks(channelData, duration, pps = 50) {
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
      const val = Math.abs(channelData[start + j]);
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

export async function extractAudioFromMedia(file, onProgress, apiBase = '') {
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
      if (onProgress) onProgress({ stage: 'reading', percent: 15, detail: 'Reading media file into memory...' });
      const arrayBuffer = await file.arrayBuffer();

      if (onProgress) onProgress({ stage: 'decoding', percent: 40, detail: 'Decoding audio track with Web Audio...' });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();

      let audioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      } finally {
        audioCtx.close().catch(() => {});
      }

      if (onProgress) onProgress({ stage: 'processing', percent: 70, detail: 'Downmixing to speech mono...' });
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

      if (onProgress) onProgress({ stage: 'encoding', percent: 85, detail: 'Encoding clean WAV for upload...' });
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

      if (onProgress) onProgress({ stage: 'done', percent: 100, detail: 'Audio extraction complete!' });

      return {
        audioBlob: wavBlob,
        audioFile: audioFile,
        peaks: peaks,
        duration: duration,
        sampleRate: targetSampleRate
      };
    } catch (browserDecodeErr) {
      console.warn("Client Web Audio decode fallback to server FFmpeg:", browserDecodeErr);
    }
  }

  // Server-Side Audio Extraction via FFmpeg (for video files or complex audio codecs)
  if (onProgress) onProgress({ stage: 'extracting', percent: 35, detail: 'Extracting clean audio track via server FFmpeg...' });
  const formData = new FormData();
  formData.append('file', file);
  
  const base = apiBase || (window.location.port === '5173' ? 'http://localhost:8000' : '');
  const res = await fetch(`${base}/api/audio/extract`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Server audio extraction failed: ${errText || res.statusText}`);
  }

  const data = await res.json();
  if (onProgress) onProgress({ stage: 'downloading', percent: 80, detail: 'Synchronizing extracted audio track...' });

  const audioFetch = await fetch(`${base}${data.audio_url}`);
  const audioBlob = await audioFetch.blob();
  const audioFile = new File([audioBlob], data.audio_filename, { type: 'audio/wav' });

  if (onProgress) onProgress({ stage: 'done', percent: 100, detail: 'Audio extracted successfully!' });

  return {
    audioBlob: audioBlob,
    audioFile: audioFile,
    peaks: data.peaks || [],
    duration: data.duration || 0,
    sampleRate: data.sample_rate || 16000,
    audioUrl: `${base}${data.audio_url}`
  };
}
