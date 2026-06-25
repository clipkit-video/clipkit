// Dependency-free WAV (RIFF/PCM) serializer.
//
// The transparent export path (ProRes 4444 / VP9-alpha) can't use the WebCodecs
// muxer, so its mixed AudioBuffer can't ride along in an MP4. Instead we
// serialize it to a plain 16-bit PCM WAV the server-side ffmpeg reads as a
// second input. WAV is the lowest-common-denominator container — no codec, no
// muxer dependency — and ffmpeg re-encodes it to the format's audio codec
// (PCM for MOV/ProRes, Opus for WebM).
//
// Output is interleaved signed 16-bit little-endian PCM (s16le), the most
// universally readable WAV flavor.

/**
 * Serialize an AudioBuffer to a 16-bit PCM (s16le) WAV file as raw bytes.
 * Channels are interleaved; sample rate / channel count come from the buffer.
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2; // s16le
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const bufferSize = 44 + dataSize; // 44-byte canonical WAV header + PCM data

  const out = new ArrayBuffer(bufferSize);
  const view = new DataView(out);

  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  // RIFF chunk descriptor
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // file size minus the first 8 bytes
  writeAscii(8, 'WAVE');

  // fmt subchunk (PCM)
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1 size (16 for PCM)
  view.setUint16(20, 1, true); // audio format = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample

  // data subchunk
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels and write clamped 16-bit samples.
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channelData.push(buffer.getChannelData(c));

  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let c = 0; c < numChannels; c++) {
      let s = channelData[c][frame];
      // Clamp to [-1, 1] then scale to the signed 16-bit range.
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return out;
}
