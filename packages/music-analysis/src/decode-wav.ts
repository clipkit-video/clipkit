// Minimal WAV decoder → mono Float32 samples. No dependencies; handles PCM
// (8/16/24/32-bit) and 32-bit float, any channel count (downmixed to mono).
// Other containers (mp3/aac/ogg) are out of scope here — decode them upstream
// and hand `analyzeAudio` the raw samples via AnalyzeOptions.

export interface DecodedAudio {
  samples: Float32Array; // mono, [-1, 1]
  sampleRate: number;
}

function str(b: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]!);
  return s;
}

export function decodeWav(bytes: Uint8Array): DecodedAudio {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (str(bytes, 0, 4) !== 'RIFF' || str(bytes, 8, 4) !== 'WAVE') {
    throw new Error('decodeWav: not a RIFF/WAVE file');
  }
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  // Walk chunks.
  let p = 12;
  while (p + 8 <= bytes.length) {
    const id = str(bytes, p, 4);
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = size;
    }
    p = body + size + (size & 1); // chunks are word-aligned
  }
  if (!fmt || dataOff < 0) throw new Error('decodeWav: missing fmt/data chunk');

  const { channels, sampleRate, bits, audioFormat } = fmt;
  const bytesPerSample = bits >> 3;
  const frameCount = Math.floor(dataLen / (bytesPerSample * channels));
  const out = new Float32Array(frameCount);
  const isFloat = audioFormat === 3;

  const read = (off: number): number => {
    if (isFloat) return bits === 64 ? dv.getFloat64(off, true) : dv.getFloat32(off, true);
    switch (bits) {
      case 8: return (dv.getUint8(off) - 128) / 128; // 8-bit PCM is unsigned
      case 16: return dv.getInt16(off, true) / 32768;
      case 24: {
        const b0 = dv.getUint8(off), b1 = dv.getUint8(off + 1), b2 = dv.getUint8(off + 2);
        let v = b0 | (b1 << 8) | (b2 << 16);
        if (v & 0x800000) v -= 0x1000000;
        return v / 8388608;
      }
      case 32: return dv.getInt32(off, true) / 2147483648;
      default: throw new Error(`decodeWav: unsupported bit depth ${bits}`);
    }
  };

  for (let i = 0; i < frameCount; i++) {
    let acc = 0;
    const base = dataOff + i * bytesPerSample * channels;
    for (let c = 0; c < channels; c++) acc += read(base + c * bytesPerSample);
    out[i] = acc / channels; // downmix
  }
  return { samples: out, sampleRate };
}
