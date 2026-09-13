import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

const capture = () => {
  const lines: string[] = [];
  return { lines, write: (l: string) => lines.push(l) };
};

describe('createLogger', () => {
  it('filters messages below the configured level', () => {
    const out = capture();
    const log = createLogger({ level: 'warn', write: out.write });
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(out.lines).toEqual(['warn  c', 'error d']);
  });

  it('renders fields as key=value in text mode', () => {
    const out = capture();
    createLogger({ write: out.write }).info('done', { pages: 3, url: 'https://x.test' });
    expect(out.lines).toEqual(['info  done pages=3 url=https://x.test']);
  });

  it('emits one JSON object per line in json mode', () => {
    const out = capture();
    createLogger({ format: 'json', write: out.write }).info('done', { pages: 3 });
    const entry = JSON.parse(out.lines[0]!);
    expect(entry).toMatchObject({ level: 'info', msg: 'done', pages: 3 });
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
