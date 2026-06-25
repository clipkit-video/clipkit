// Library entry for @clipkit/mcp-server.
//
// Importing the package (`@clipkit/mcp-server`) gives these building blocks for
// HOSTING the server — e.g. behind a stateless HTTP route — WITHOUT the stdio
// bootstrap that runs on import of index.ts. The stdio CLI remains the package
// `bin` and the `./stdio` subpath export.
//
// A host wires it up the same way index.ts does, but with its own transport and
// (typically) a non-in-memory ProjectStore:
//
//   const server = new McpServer(SERVER_INFO, {
//     capabilities: SERVER_CAPABILITIES,
//     instructions: SERVER_INSTRUCTIONS,
//   });
//   registerTools(server, store);   // store implements ProjectStore
//   registerResources(server);

export { registerTools } from './tools.js';
export { registerResources } from './resources.js';
export { SERVER_INFO, SERVER_CAPABILITIES, SERVER_INSTRUCTIONS } from './server-config.js';
export {
  type ProjectStore,
  type OpenProject,
  openProject,
  InMemoryProjectStore,
} from './project-store.js';
export { blankSource, cloneSource, locateElement, type ElementLocation } from './state.js';
export { SOURCE_SCHEMA_JSON, elementSchemaJson } from './schema-json.js';
