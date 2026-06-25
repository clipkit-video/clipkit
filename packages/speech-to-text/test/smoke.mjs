// End-to-end smoke test: a real audio file → transcript → caption words.
// Downloads a Whisper model on first run (cached after), so it's NOT part of the
// fast suite. Run manually:  node packages/speech-to-text/test/smoke.mjs <file>
//
// With no file arg it synthesizes one with macOS `say` (known ground truth).

import { spawnSync } from 'node:child_process';
import { transcribe, toCaptionWords } from '../dist/index.js';
import { decodeAudioFile } from '../dist/audio.node.js';

const SENTENCE = 'hello world this is a clipkit transcription test';
let file = process.argv[2];

if (!file) {
  file = '/tmp/clipkit-stt-smoke.aiff';
  const r = spawnSync('say', ['-o', file, SENTENCE], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('Could not synthesize speech (`say` unavailable). Pass an audio file: node smoke.mjs <file>');
    process.exit(2);
  }
  console.log(`synthesized: "${SENTENCE}"`);
}

console.log('decoding…');
const audio = await decodeAudioFile(file);
console.log(`  ${(audio.samples.length / audio.sampleRate).toFixed(2)}s @ ${audio.sampleRate}Hz`);

console.log('transcribing (whisper-tiny.en, first run downloads the model)…');
const t0 = Date.now();
const seen = new Set();
const result = await transcribe(audio, {
  model: 'Xenova/whisper-tiny.en',
  onProgress: (i) => { if (i.status === 'initiate' && i.file && !seen.has(i.file)) { seen.add(i.file); console.log(`  ↓ ${i.file}`); } },
});
console.log(`\n  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const words = toCaptionWords(result);
console.log('\ntranscript:', JSON.stringify(result.text));
console.log('words:', words.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(' '));

// Assertions: non-empty, monotonic, nonnegative, and roughly the right content.
let ok = words.length > 0;
let prev = -1;
for (const w of words) { if (w.start < prev || w.start < 0 || w.end < w.start) ok = false; prev = w.start; }
const lower = result.text.toLowerCase();
const hits = ['hello', 'world', 'clipkit', 'test'].filter((k) => lower.includes(k));
console.log(`\nkeyword hits: ${hits.join(', ')} (${hits.length}/4)`);
console.log(ok && hits.length >= 2 ? '\n✅ SMOKE PASS' : '\n❌ SMOKE FAIL');
process.exit(ok && hits.length >= 2 ? 0 : 1);
