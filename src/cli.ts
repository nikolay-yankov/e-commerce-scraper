#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createFetcher } from './fetcher.js';
import { scrape } from './scrape.js';

const DEFAULT_URL = 'https://webscraper.io/test-sites/e-commerce/static';

const HELP = `Usage: ecommerce-scraper [options]

Scrapes every product reachable from the start URL and prints a JSON report to stdout.
Progress and errors go to stderr, so the output can be piped safely.

Options:
  -u, --url <url>          Start URL (default: ${DEFAULT_URL})
  -c, --concurrency <n>    Parallel requests (default: 5)
  -o, --output <file>      Write JSON to a file instead of stdout
  -q, --quiet              Suppress progress logging
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
      quiet: { type: 'boolean', short: 'q', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${values.concurrency}"`);
  }

  const log = values.quiet ? () => {} : (msg: string) => console.error(msg);
  const { report, failures } = await scrape({
    startUrl: values.url,
    fetchText: createFetcher(),
    concurrency,
    log,
  });

  const json = JSON.stringify(report, null, 2);
  if (values.output) {
    await writeFile(values.output, json + '\n');
    log(`wrote ${report.results.length} products to ${values.output}`);
  } else {
    process.stdout.write(json + '\n');
  }

  for (const { url, error } of failures) {
    console.error(`FAILED ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return failures.length > 0 ? 2 : 0;
}

// Set exitCode rather than calling process.exit(): stdout writes to a pipe are async and
// exit() would truncate large reports at ~64 KB before the buffer is flushed.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
