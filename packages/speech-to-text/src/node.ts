// Node entry — `@clipkit/speech-to-text/node`. Audio extraction (ffmpeg) plus
// the safe one-call `transcribeFile` (worker-isolated). The model engine and the
// protocol bridge stay env-agnostic on the main export.

export { decodeAudioFile } from './audio.node.js';
export { transcribeFile, type TranscribeFileOptions } from './transcribe-file.node.js';
