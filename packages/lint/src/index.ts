// @clipkit/lint — protocol-aware soft checks + plain-language summaries.
// Pure functions over a validated Source; no I/O. Shared by the CLI and MCP server.

export { lintSource, type LintWarning } from './lint.js';
export { describe } from './describe.js';
export {
  unknownKeys,
  unknownElementKeys,
  unrecognizedKeys,
  unrecognizedElementKeys,
} from './unknown-keys.js';
export { droppedKeys } from './dropped-keys.js';
