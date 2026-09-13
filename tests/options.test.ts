import { describe, expect, it } from 'vitest';
import { parseOptions } from '../src/options.js';

describe('parseOptions', () => {
  it('applies defaults and coerces numbers', () => {
    expect(parseOptions([])).toMatchObject({
      url: 'https://webscraper.io/test-sites/e-commerce/static',
      concurrency: 5,
      delay: 0,
      'max-pages': 1000,
      'log-format': 'text',
      verbose: false,
      quiet: false,
    });
    expect(parseOptions(['-c', '2', '--delay', '50'])).toMatchObject({ concurrency: 2, delay: 50 });
  });

  it('reports every invalid flag at once', () => {
    expect(() => parseOptions(['-c', '0', '--log-format', 'xml'])).toThrow(
      /--concurrency: .*\n.*--log-format: /,
    );
  });
});
