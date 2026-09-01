/**
 * Client-Side Audio Extractor & 16kHz Mono WAV Encoder
 * Enables ultra-fast transcription by extracting audio in-browser so users
 * never upload heavy video files (e.g. 500MB video -> 2MB 16kHz audio).
 */

/**
 * Extracts the audio track from a video/audio File and encodes to 16kHz mono WAV Blob
 */
export async function extractAudioFromMedia(
  file: File,
  onProgress?: (percent: number, status: string) => void
): Promise<{ blob: Blob; duration: number }> {
  onProgress?.(10, 'Reading media file...');
  const arrayBuffer = await file.arrayBuffer();

  onProgress?.(30, 'Decoding audio track...');
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch (err) {
    await audioContext.close();
    throw new Error('Could not decode audio from this file. Ensure the video contains an active audio track.');
  }

  const duration = audioBuffer.duration;
  onProgress?.(60, 'Resampling to 16kHz mono...');

  // Resample to 16000 Hz mono (the optimal input format for OpenAI Whisper)
  const targetSampleRate = 16000;
  const offlineContext = new OfflineAudioContext(
    1, // mono channel
    Math.ceil(duration * targetSampleRate),
    targetSampleRate
  );

  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);

  const renderedBuffer = await offlineContext.startRendering();
  await audioContext.close();

  onProgress?.(85, 'Encoding WAV buffer...');
  const wavBlob = encodeWAV(renderedBuffer.getChannelData(0), targetSampleRate);

  onProgress?.(100, 'Audio extracted successfully!');
  return { blob: wavBlob, duration };
}

/**
 * Encodes Float32Array PCM samples to 16-bit PCM WAV Blob
 */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // RIFF chunk length
  view.setUint32(4, 36 + samples.length * 2, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 = PCM)
  view.setUint16(20, 1, true);
  // channel count (1 = mono)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * 1 * 2)
  view.setUint32(28, sampleRate * 2, true);
  // block align (1 * 2)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, samples.length * 2, true);

  // Write PCM samples (convert float to 16-bit int with clipping)
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
