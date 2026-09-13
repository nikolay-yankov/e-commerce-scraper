#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createFetcher } from './fetcher.js';
import { createLogger, type LogFormat } from './logger.js';
import { scrape } from './scrape.js';

const DEFAULT_URL = 'https://webscraper.io/test-sites/e-commerce/static';

const HELP = `Usage: ecommerce-scraper [options]

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

Exit codes: 0 success, 1 fatal error, 2 completed with some product pages failed.
`;

export async function main(argv: string[]): Promise<number> {
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
    process.stdout.write(HELP);
    return 0;
  }

  const concurrency = positiveInt('--concurrency', values.concurrency);
  const delayMs = nonNegativeInt('--delay', values.delay);
  const maxPages = positiveInt('--max-pages', values['max-pages']);
  const format = values['log-format'];
  if (format !== 'text' && format !== 'json') {
    throw new Error(`--log-format must be "text" or "json", got "${format}"`);
  }

  const logger = createLogger({
    level: values.verbose ? 'debug' : values.quiet ? 'warn' : 'info',
    format: format as LogFormat,
  });

  const shutdown = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      logger.warn('shutting down', { signal: sig });
      shutdown.abort(new ShutdownError(sig));
    });
  }

  let retries = 0;
  const fetchText = createFetcher({
    delayMs,
    onRetry: ({ url, attempt, error }) => {
      retries++;
      logger.warn('retrying', { url, attempt, reason: errorMessage(error) });
    },
  });

  const { report, failures, stats } = await scrape({
    startUrl: values.url,
    fetchText,
    concurrency,
    logger,
    signal: shutdown.signal,
    maxPages,
  });

  const json = JSON.stringify(report, null, 2);
  if (values.output) {
    await writeFile(values.output, json + '\n');
  } else {
    process.stdout.write(json + '\n');
  }

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
}

/** Raised on SIGINT/SIGTERM; carries the conventional 128 + signal-number exit code. */
class ShutdownError extends Error {
  readonly exitCode: number;
  constructor(signal: 'SIGINT' | 'SIGTERM') {
    super(`received ${signal}`);
    this.exitCode = signal === 'SIGINT' ? 130 : 143;
  }
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

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Set exitCode rather than calling process.exit(): stdout writes to a pipe are async and
// exit() would truncate large reports at ~64 KB before the buffer is flushed.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`fatal: ${errorMessage(err)}`);
    process.exitCode = err instanceof ShutdownError ? err.exitCode : 1;
  });
