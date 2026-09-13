import { access, constants, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { createFetcher, type FetchFn } from './fetcher.js';
import { createLogger } from './logger.js';
import { HELP, parseOptions } from './options.js';
import { scrape } from './scrape.js';

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
  const options = parseOptions(argv);
  if (options.help) {
    stdout.write(HELP);
    return 0;
  }
  // Fail before crawling, not after, if the output directory isn't writable.
  if (options.output) await access(dirname(resolve(options.output)), constants.W_OK);

  const logger = createLogger({
    level: options.verbose ? 'debug' : options.quiet ? 'warn' : 'info',
    format: options['log-format'],
    write: (line) => stderr.write(line + '\n'),
  });

  let retries = 0;
  const fetchText = createFetcher({
    fetch,
    delayMs: options.delay,
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
      startUrl: options.url,
      fetchText,
      concurrency: options.concurrency,
      maxPages: options['max-pages'],
      signal: shutdown.signal,
      logger,
    });

    const json = JSON.stringify(report, null, 2) + '\n';
    if (options.output) await writeFile(options.output, json);
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
      ...(options.output && { output: options.output }),
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
