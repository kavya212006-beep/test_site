/**
 * High-Performance Client-Side Audio Extractor & 16kHz Mono WAV Chunker
 * Extracts clean audio tracks from any video (MP4, MOV, WebM, MKV) or audio file (MP3, WAV, M4A, OGG, AAC)
 * in-browser without uploading heavy video files to servers.
 */

export interface AudioChunk {
  blob: Blob;
  startSec: number;
  endSec: number;
  index: number;
  total: number;
}

export interface ExtractedAudioResult {
  blob: Blob;
  duration: number;
  sampleRate: number;
  chunks: AudioChunk[];
}

/**
 * Extracts audio track from video/audio File and converts to 16kHz Mono 16-bit WAV PCM
 */
export async function extractAudioFromMedia(
  file: File,
  onProgress?: (percent: number, status: string) => void
): Promise<ExtractedAudioResult> {
  onProgress?.(5, 'Reading media file...');

  let audioBuffer: AudioBuffer | null = null;

  // Strategy 1: Fast direct ArrayBuffer Web Audio API decode
  try {
    onProgress?.(15, 'Extracting audio stream...');
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Use a copy to prevent buffer detaching
    const bufferCopy = arrayBuffer.slice(0);
    audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      audioContext.decodeAudioData(
        bufferCopy,
        (decoded) => {
          audioContext.close();
          resolve(decoded);
        },
        (err) => {
          audioContext.close();
          reject(err);
        }
      );
    });
  } catch (directErr) {
    console.info('Direct Web Audio decode bypassed, falling back to video element extraction:', directErr);
  }

  // Strategy 2: If direct decode failed (e.g. MP4/MOV container in certain browsers), use HTMLVideoElement extraction
  if (!audioBuffer) {
    onProgress?.(25, 'Demuxing video audio track...');
    audioBuffer = await extractAudioViaVideoElement(file, onProgress);
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Could not extract any audio from this video. Please ensure the video has an audible sound track.');
  }

  const originalDuration = audioBuffer.duration;
  const targetSampleRate = 16000;
  onProgress?.(65, 'Resampling to 16kHz Whisper format...');

  // Resample audio to 16,000 Hz Mono (Whisper optimal acoustic standard)
  const offlineContext = new OfflineAudioContext(
    1, // mono
    Math.max(1, Math.ceil(originalDuration * targetSampleRate)),
    targetSampleRate
  );

  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);

  const renderedBuffer = await offlineContext.startRendering();
  const channelData = renderedBuffer.getChannelData(0);

  onProgress?.(85, 'Encoding 16-bit PCM WAV chunks...');

  // Encode full audio
  const fullBlob = encodeWAV(channelData, targetSampleRate);

  // Split into ~20-second chunks for maximum Whisper accuracy and zero timeouts
  const chunkDurationSec = 20;
  const samplesPerChunk = chunkDurationSec * targetSampleRate;
  const totalChunks = Math.max(1, Math.ceil(channelData.length / samplesPerChunk));
  const chunks: AudioChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const startSample = i * samplesPerChunk;
    const endSample = Math.min(channelData.length, (i + 1) * samplesPerChunk);
    const chunkSamples = channelData.subarray(startSample, endSample);
    const chunkBlob = encodeWAV(chunkSamples, targetSampleRate);
    
    chunks.push({
      blob: chunkBlob,
      startSec: Math.round((startSample / targetSampleRate) * 100) / 100,
      endSec: Math.round((endSample / targetSampleRate) * 100) / 100,
      index: i,
      total: totalChunks,
    });
  }

  onProgress?.(100, 'Audio extracted and ready for AI Whisper!');

  return {
    blob: fullBlob,
    duration: originalDuration,
    sampleRate: targetSampleRate,
    chunks,
  };
}

/**
 * Extracts audio using HTMLVideoElement and MediaStream capture
 */
async function extractAudioViaVideoElement(
  file: File,
  onProgress?: (percent: number, status: string) => void
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = false;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.remove();
    };

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration || 10;
        if (!isFinite(duration) || duration <= 0) {
          cleanup();
          return reject(new Error('Invalid video duration.'));
        }

        // Try Web Audio MediaElementSource if allowed
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Use captureStream if available
        let stream: MediaStream | null = null;
        if (typeof (video as any).captureStream === 'function') {
          stream = (video as any).captureStream();
        } else if (typeof (video as any).mozCaptureStream === 'function') {
          stream = (video as any).mozCaptureStream();
        }

        if (stream && stream.getAudioTracks().length > 0) {
          const mediaRecorder = new MediaRecorder(stream);
          const chunks: Blob[] = [];

          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };

          mediaRecorder.onstop = async () => {
            cleanup();
            try {
              const audioBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
              const audioArrBuffer = await audioBlob.arrayBuffer();
              const decoded = await audioCtx.decodeAudioData(audioArrBuffer);
              await audioCtx.close();
              resolve(decoded);
            } catch (decErr) {
              await audioCtx.close();
              reject(decErr);
            }
          };

          video.playbackRate = 4.0; // accelerate capture 4x
          mediaRecorder.start();
          await video.play();

          video.onended = () => {
            mediaRecorder.stop();
          };
          return;
        }

        cleanup();
        reject(new Error('Could not capture audio stream from this video format.'));
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Browser could not load video file. Please check video codec.'));
    };
  });
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

  // Write PCM samples (convert float to 16-bit signed integer with clipping)
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
