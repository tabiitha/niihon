export type LogLevel = 'info' | 'warn' | 'error';

export type Logger = (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;

/** Writes one JSON object per line, so tests and container logs can parse events. */
export function createJsonLogger(write: (line: string) => void = (line) => process.stdout.write(line)): Logger {
  return (level, event, fields = {}) => {
    write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })}\n`);
  };
}

export const silentLogger: Logger = () => {};
