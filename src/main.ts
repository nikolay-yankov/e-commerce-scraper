import { access, constants, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { z } from 'zod';
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

/** parseArgs only knows strings and booleans; zod turns them into validated, typed options. */
const OptionsSchema = z.object({
  url: z.url(),
  concurrency: z.coerce.number().int().min(1),
  delay: z.coerce.number().int().min(0),
  'max-pages': z.coerce.number().int().min(1),
  'log-format': z.enum(['text', 'json']),
  output: z.string().optional(),
  verbose: z.boolean(),
  quiet: z.boolean(),
  help: z.boolean(),
});

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
  const { values: raw } = parseArgs({
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

  if (raw.help) {
    stdout.write(HELP);
    return 0;
  }

  const parsed = OptionsSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `--${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid options\n  ${problems.join('\n  ')}`);
  }
  const values = parsed.data;
  // Fail before crawling, not after, if the output directory isn't writable.
  if (values.output) await access(dirname(resolve(values.output)), constants.W_OK);

  const logger = createLogger({
    level: values.verbose ? 'debug' : values.quiet ? 'warn' : 'info',
    format: values['log-format'],
    write: (line) => stderr.write(line + '\n'),
  });

  let retries = 0;
  const fetchText = createFetcher({
    fetch,
    delayMs: values.delay,
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
      concurrency: values.concurrency,
      logger,
      signal: shutdown.signal,
      maxPages: values['max-pages'],
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
