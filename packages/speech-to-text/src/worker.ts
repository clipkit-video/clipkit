// Internal worker entry. Runs in its OWN process so onnxruntime-node's harmless
// `mutex lock failed` teardown abort can never take down the caller (CLI, MCP
// server, editor build). Decodes + transcribes one file, prints the
// TranscriptResult as JSON to stdout, then exits. Not a public export — invoked
// by `transcribeFile` (transcribe-file.node.ts).
//
//   node dist/worker.js '{"file":"clip.mp4","model":"Xenova/whisper-base"}'

import { transcribe } from './transcribe.js';
import { decodeAudioFile } from './audio.node.js';

interface WorkerInput {
  file: string;
  model?: string;
  language?: string;
}

const input = JSON.parse(process.argv[2] ?? '{}') as WorkerInput;
const audio = await decodeAudioFile(input.file);
const seen = new Set<string>();
const result = await transcribe(audio, {
  model: input.model,
  language: input.language,
  // Surface model-download progress on stderr (stdout is reserved for the JSON
  // result); the caller streams these via `transcribeFile`'s onLog.
  onProgress: (i) => {
    if (i.status === 'initiate' && i.file && !seen.has(i.file)) {
      seen.add(i.file);
      process.stderr.write(`  ↓ ${i.file}\n`);
    }
  },
});
process.stdout.write(JSON.stringify(result), () => process.exit(0));
