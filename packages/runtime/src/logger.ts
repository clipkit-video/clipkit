// Pluggable logger. The runtime prefixes its console output with `[clipkit]`
// (formerly `[v0]` in the upstream prototype). Consumers can swap in their
// own logger, silence everything, or route through their existing observability.

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const consoleLogger: Logger = {
  debug: (m, ...a) => console.debug(`[clipkit] ${m}`, ...a),
  info: (m, ...a) => console.info(`[clipkit] ${m}`, ...a),
  warn: (m, ...a) => console.warn(`[clipkit] ${m}`, ...a),
  error: (m, ...a) => console.error(`[clipkit] ${m}`, ...a),
};

let activeLogger: Logger = consoleLogger;

/**
 * Replace the runtime's logger. Pass `'console'` to log to the browser console
 * (default), `'silent'` to suppress everything, or a custom Logger object.
 */
export function setLogger(logger: Logger | 'console' | 'silent'): void {
  if (logger === 'console') activeLogger = consoleLogger;
  else if (logger === 'silent') activeLogger = silentLogger;
  else activeLogger = logger;
}

export function getLogger(): Logger {
  return activeLogger;
}
