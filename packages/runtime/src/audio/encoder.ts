// WebCodecs AudioEncoder integration for the exporter.
//
// Takes a rendered AudioBuffer (output of `mixSourceAudio`), chunks it into
// AudioData frames, encodes via AudioEncoder (AAC-LC), and writes the
// resulting EncodedAudioChunks into the muxer's audio track.

import type { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { getLogger } from '../logger.js';

export interface AudioEncodeOptions {
  /** AAC bitrate in bits/second. Default 128 kbps. */
  bitrate?: number;
  /** Codec string. Default 'mp4a.40.2' (AAC-LC). */
  codec?: string;
  /** Samples per AudioData chunk. Default 1024 (typical AAC frame size). */
  chunkSize?: number;
}

const DEFAULT_BITRATE = 128_000;
const DEFAULT_CODEC = 'mp4a.40.2';
const DEFAULT_CHUNK_SIZE = 1024;

/** A muxer codec id paired with the matching WebCodecs encoder codec string. */
export interface PickedAudioCodec {
  /** mp4-muxer / webm-muxer audio codec id. */
  muxer: 'aac' | 'opus';
  /** WebCodecs AudioEncoder codec string. */
  encoder: string;
}

/**
 * Pick an audio codec this environment's WebCodecs AudioEncoder can actually
 * encode. AAC ('mp4a.40.2') is preferred (most universal in MP4), but
 * Chromium on Linux ships NO AAC encoder — only macOS/Windows borrow the OS
 * one — so on the Linux render container it falls back to Opus, which Chromium
 * encodes everywhere (and which MP4/WebM both mux). Returns null when no audio
 * encoder exists at all, so the caller can render silently instead of throwing
 * "Unsupported codec type" mid-export.
 */
export async function pickAudioCodec(
  sampleRate: number,
  numberOfChannels: number,
  bitrate = DEFAULT_BITRATE,
): Promise<PickedAudioCodec | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const candidates: PickedAudioCodec[] = [
    { muxer: 'aac', encoder: 'mp4a.40.2' },
    { muxer: 'opus', encoder: 'opus' },
  ];
  for (const c of candidates) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({
        codec: c.encoder,
        sampleRate,
        numberOfChannels,
        bitrate,
      });
      if (supported) return c;
    } catch {
      /* malformed/unsupported codec string → try the next candidate */
    }
  }
  return null;
}

/**
 * Encode an AudioBuffer through WebCodecs and feed chunks into the muxer.
 */
export async function encodeAudioBuffer(
  buffer: AudioBuffer,
  muxer: Muxer<ArrayBufferTarget>,
  options: AudioEncodeOptions = {},
): Promise<void> {
  if (typeof AudioEncoder === 'undefined') {
    throw new Error('WebCodecs AudioEncoder is not available in this environment');
  }

  const bitrate = options.bitrate ?? DEFAULT_BITRATE;
  const codec = options.codec ?? DEFAULT_CODEC;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;

  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      muxer.addAudioChunk(chunk, metadata);
    },
    error: (error) => {
      getLogger().error('AudioEncoder error:', error.message);
    },
  });

  encoder.configure({
    codec,
    sampleRate,
    numberOfChannels: channels,
    bitrate,
  });

  // Interleave channels into a single Float32Array per chunk.
  const totalFrames = buffer.length;
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) channelData.push(buffer.getChannelData(ch));

  for (let offset = 0; offset < totalFrames; offset += chunkSize) {
    const frames = Math.min(chunkSize, totalFrames - offset);
    const interleaved = new Float32Array(frames * channels);
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < channels; ch++) {
        interleaved[i * channels + ch] = channelData[ch]![offset + i]!;
      }
    }

    const audioData = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000), // microseconds
      data: interleaved,
    });

    encoder.encode(audioData);
    audioData.close();
  }

  await encoder.flush();
  encoder.close();
}
