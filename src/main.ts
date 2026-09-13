import { access, constants, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { createFetcher, type FetchFn } from './fetcher.js';
import { createLogger } from './logger.js';
import { scrape } from './scrape.js';

const DEFAULT_URL = 'https://webscraper.io/test-sites/e-commerce/static';

export const HELP = `Usage: ecommerce-scraper [options]

Scrapes every product reachable from the start URL and prints a JSON report to stdout.
Logs go to stderr, so the output can be piped safely.

Options:
  -u, --url <url>          Start URL (default: ${DEFAULT_URL})
  -c, --concurrency <n>    Parallel requests (default: 5)
  -o, --output <file>      Write JSON to a file instead of stdout
      --delay <ms>         Pause before every request (default: 0)
      --max-pages <n>      Abort if the crawl would fetch more pages than this (default: 1000)
  -v, --verbose            Log every fetched page (debug level)
  -q, --quiet              Only log warnings and errors
      --log-format <fmt>   "text" (default) or "json" (one object per line)
  -h, --help               Show this help

Exit codes: 0 success, 1 fatal error, 2 completed with some product pages failed,
            130/143 stopped by SIGINT/SIGTERM.
`;

/** Process-level dependencies, injectable so the CLI can be tested without a network or TTY. */
export interface MainIO {
  fetch?: FetchFn;
  stdout?: Writable;
  stderr?: Writable;
}

/** Raised on SIGINT/SIGTERM; carries the conventional 128 + signal-number exit code. */
export class ShutdownError extends Error {
  readonly exitCode: number;
  constructor(signal: 'SIGINT' | 'SIGTERM') {
    super(`received ${signal}`);
    this.exitCode = signal === 'SIGINT' ? 130 : 143;
  }
}

/** Runs the CLI and resolves to its exit code. Throws for fatal errors (the entrypoint maps those). */
export async function main(
  argv: string[],
  { fetch = globalThis.fetch, stdout = process.stdout, stderr = process.stderr }: MainIO = {},
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string', short: 'u', default: DEFAULT_URL },
      concurrency: { type: 'string', short: 'c', default: '5' },
      output: { type: 'string', short: 'o' },
      delay: { type: 'string', default: '0' },
      'max-pages': { type: 'string', default: '1000' },
      verbose: { type: 'boolean', short: 'v', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      'log-format': { type: 'string', default: 'text' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    stdout.write(HELP);
    return 0;
  }

  const concurrency = positiveInt('--concurrency', values.concurrency);
  const delayMs = nonNegativeInt('--delay', values.delay);
  const maxPages = positiveInt('--max-pages', values['max-pages']);
  const format = values['log-format'];
  if (format !== 'text' && format !== 'json') {
    throw new Error(`--log-format must be "text" or "json", got "${format}"`);
  }
  // Fail before crawling, not after, if the output can't be written.
  if (values.output) await assertWritable(values.output);

  const logger = createLogger({
    level: values.verbose ? 'debug' : values.quiet ? 'warn' : 'info',
    format,
    write: (line) => stderr.write(line + '\n'),
  });

  let retries = 0;
  const fetchText = createFetcher({
    fetch,
    delayMs,
    onRetry: ({ url, attempt, error }) => {
      retries++;
      logger.warn('retrying', { url, attempt, reason: errorMessage(error) });
    },
  });

  const shutdown = new AbortController();
  const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    logger.warn('shutting down', { signal });
    shutdown.abort(new ShutdownError(signal));
  };
  process.on('SIGINT', onSignal).on('SIGTERM', onSignal);

  try {
    const { report, failures, stats } = await scrape({
      startUrl: values.url,
      fetchText,
      concurrency,
      logger,
      signal: shutdown.signal,
      maxPages,
    });

    const json = JSON.stringify(report, null, 2) + '\n';
    if (values.output) await writeFile(values.output, json);
    else stdout.write(json);

    for (const { url, error } of failures) {
      logger.error('product page failed', { url, reason: errorMessage(error) });
    }
    logger.info('done', {
      ...stats,
      results: report.results.length,
      total: report.total,
      failures: failures.length,
      retries,
      ...(values.output && { output: values.output }),
    });
    return failures.length > 0 ? 2 : 0;
  } finally {
    process.off('SIGINT', onSignal).off('SIGTERM', onSignal);
  }
}

/** "Failed to fetch X after 1 attempt(s): HTTP 404 for X" — walks the `cause` chain. */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause === undefined ? err.message : `${err.message}: ${errorMessage(err.cause)}`;
}

/** The file must be writable if it exists, otherwise its directory must be. */
async function assertWritable(file: string): Promise<void> {
  const target = await access(file, constants.W_OK).then(
    () => file,
    () => dirname(resolve(file)),
  );
  await access(target, constants.W_OK).catch(() => {
    throw new Error(`Cannot write to ${target} (for --output ${file})`);
  });
}

function nonNegativeInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${flag} must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

function positiveInt(flag: string, raw: string): number {
  const n = nonNegativeInt(flag, raw);
  if (n === 0) throw new Error(`${flag} must be at least 1`);
  return n;
}
