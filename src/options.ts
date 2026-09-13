import { parseArgs } from 'node:util';
import { z } from 'zod';

const DEFAULTS = {
  url: 'https://webscraper.io/test-sites/e-commerce/static',
  concurrency: 5,
  delay: 0,
  maxPages: 1000,
  logFormat: 'text',
} as const;

export const HELP = `Usage: ecommerce-scraper [options]

Scrapes every product reachable from the start URL and prints a JSON report to stdout.
Logs go to stderr, so the output can be piped safely.

Options:
  -u, --url <url>          Start URL (default: ${DEFAULTS.url})
  -c, --concurrency <n>    Parallel requests (default: ${DEFAULTS.concurrency})
  -o, --output <file>      Write JSON to a file instead of stdout
      --delay <ms>         Pause before every request (default: ${DEFAULTS.delay})
      --max-pages <n>      Abort if the crawl would fetch more pages than this (default: ${DEFAULTS.maxPages})
  -v, --verbose            Log every fetched page (debug level)
  -q, --quiet              Only log warnings and errors
      --log-format <fmt>   "text" (default) or "json" (one object per line)
  -h, --help               Show this help

Exit codes: 0 success, 1 fatal error, 2 completed with some product pages failed,
            130/143 stopped by SIGINT/SIGTERM.
`;

/** parseArgs only knows strings and booleans; zod turns them into validated, typed options. */
const OptionsSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  concurrency: z.coerce.number().int().min(1),
  delay: z.coerce.number().int().min(0),
  'max-pages': z.coerce.number().int().min(1),
  'log-format': z.enum(['text', 'json']),
  output: z.string().optional(),
  verbose: z.boolean(),
  quiet: z.boolean(),
  help: z.boolean(),
});
export type Options = z.infer<typeof OptionsSchema>;

/** Parses and validates argv. Throws a message listing every invalid flag. */
export function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string', short: 'u', default: DEFAULTS.url },
      concurrency: { type: 'string', short: 'c', default: String(DEFAULTS.concurrency) },
      output: { type: 'string', short: 'o' },
      delay: { type: 'string', default: String(DEFAULTS.delay) },
      'max-pages': { type: 'string', default: String(DEFAULTS.maxPages) },
      verbose: { type: 'boolean', short: 'v', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      'log-format': { type: 'string', default: DEFAULTS.logFormat },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const parsed = OptionsSchema.safeParse(values);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `--${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid options\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
