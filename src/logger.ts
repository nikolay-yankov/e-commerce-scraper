export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'text' | 'json';
export type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

const SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Minimal structured logger writing to stderr (stdout is reserved for the report).
 * `text` is for humans at a terminal; `json` emits one object per line for log aggregators.
 */
export function createLogger({
  level = 'info',
  format = 'text',
  write = (line: string) => process.stderr.write(line + '\n'),
}: { level?: LogLevel; format?: LogFormat; write?: (line: string) => void } = {}): Logger {
  const emit = (lvl: LogLevel, msg: string, fields?: Fields) => {
    if (SEVERITY[lvl] < SEVERITY[level]) return;
    write(
      format === 'json'
        ? JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields })
        : `${lvl.padEnd(5)} ${msg}${fields ? ' ' + formatFields(fields) : ''}`,
    );
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const formatFields = (fields: Fields) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' && !/\s/.test(v) ? v : JSON.stringify(v)}`)
    .join(' ');
