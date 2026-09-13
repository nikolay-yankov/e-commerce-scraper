# E-Commerce Scraper

[![CI](https://github.com/nikolay-yankov/e-commerce-scraper/actions/workflows/ci.yml/badge.svg)](https://github.com/nikolay-yankov/e-commerce-scraper/actions/workflows/ci.yml)

A small command-line application that crawls
[webscraper.io's static e-commerce test site](https://webscraper.io/test-sites/e-commerce/static),
follows every product link (categories, sub-categories, pagination) and prints a single JSON
report of all products, with each storage (HDD) option expanded into its own entry.

```json
{
  "results": [
    { "name": "Dell Latitude 5580 128 GB", "description": "...", "price": 1144.4 },
    { "name": "Dell Latitude 5580 256 GB", "description": "...", "price": 1144.4 },
    {
      "name": "Nokia 123",
      "description": "7 day battery",
      "price": 24.99,
      "colors": ["Gold", "White", "Black"]
    }
  ],
  "total": 337421.52
}
```

## Quick start

Requires Node.js 24 (LTS). No browser or system dependencies.

```bash
npm ci
npm run build
npm start                         # JSON to stdout, a two-line summary on stderr
npm start -- -o output.json       # write to a file instead
```

Or with Docker:

```bash
docker build -t ecommerce-scraper .
docker run --rm ecommerce-scraper > output.json
```

The image runs as a non-root user, so to write with `-o` mount a directory:
`docker run --rm -v "$PWD:/out" ecommerce-scraper -o /out/output.json`.

### Options

```
-u, --url <url>          Start URL (default: the static test site)
-c, --concurrency <n>    Parallel requests (default: 5)
-o, --output <file>      Write JSON to a file instead of stdout
    --delay <ms>         Pause before every request (default: 0)
    --max-pages <n>      Abort if the crawl would fetch more pages than this (default: 1000)
-v, --verbose            Log every fetched page
-q, --quiet              Only log warnings and errors
    --log-format <fmt>   text (default) or json — one object per line for log aggregators
-h, --help               Show help
```

Exit codes: `0` success · `1` fatal error · `2` finished, but some product pages failed (they are
listed on stderr; the report contains the rest) · `130`/`143` stopped by SIGINT/SIGTERM.

A run ends with a summary line you can alert on:

```
info  done listingPages=32 productPages=147 durationMs=1338 results=423 total=337421.52 failures=0 retries=0
```

## How it works

```
cli ─▶ crawler ─▶ parser ─▶ expand ─▶ report ─▶ stdout
          │           │
          └───────────┴── fetcher (timeout · retries · concurrency cap)
```

| Module                             | Responsibility                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/cli.ts`](src/cli.ts)         | Argument parsing, wiring, exit codes. JSON goes to stdout, logs to stderr, so output can be piped.                                                                                                  |
| [`src/fetcher.ts`](src/fetcher.ts) | `fetch` with a timeout, exponential-backoff retries on 5xx/429/network errors, and a polite User-Agent. Injectable, so tests never touch the network.                                               |
| [`src/crawler.ts`](src/crawler.ts) | Breadth-first crawl of every page under the start URL's path. Collects unique `/product/N` links; listing pages are fetched exactly once. No category names are hard-coded.                         |
| [`src/parser.ts`](src/parser.ts)   | HTML → `ProductPage`. The **only** file that knows the site's markup; uses the page's `schema.org` microdata (`itemprop="name"`, `itemprop="price"`, …), which is more stable than CSS class names. |
| [`src/expand.ts`](src/expand.ts)   | `ProductPage` → `Product[]`. One product per available HDD option; `colors` only when there is more than one.                                                                                       |
| [`src/report.ts`](src/report.ts)   | Builds `{ results, total }`. Totals are summed in integer cents to avoid floating-point drift.                                                                                                      |
| [`src/schema.ts`](src/schema.ts)   | Zod schemas — one definition gives both TypeScript types and runtime validation of parsed data and final output.                                                                                    |
| [`src/scrape.ts`](src/scrape.ts)   | Composes the above into one `scrape()` call used by both the CLI and the e2e test.                                                                                                                  |

### Design decisions

- **No headless browser.** The site is server-rendered; every value is in the HTML response. Plain
  `fetch` + [cheerio](https://cheerio.js.org/) is ~50× lighter than Playwright, deterministic, and
  trivially mockable. (webscraper.io's `/ajax`, `/more` and `/scroll` variants would need a browser.)
- **Pure functions, no class hierarchy.** Transforms (`parse`, `expand`, `report`) are stateless and
  take plain data; I/O is injected as a function (`fetchText`). That gives full testability without
  inheritance or mocks of global state.
- **Generic crawl rather than a hard-coded path.** The crawler discovers `computers/laptops?page=17`
  the same way it discovers the home page, so a new category on the site needs no code change.
  The `visited` set matters: featured products on landing pages duplicate catalogue entries.
- **Disabled options are not "available".** HDD swatches marked `disabled` (e.g. 1024 GB) are
  skipped, per the requirement to collect _available_ products.
- **Partial failure is a first-class outcome.** One dead product page shouldn't lose the other 146.
  Failures are reported on stderr with exit code `2`; a missing _listing_ page, which would silently
  drop products, is fatal.
- **Money as cents.** `0.1 + 0.2 !== 0.3`; `total` is accumulated as integers and divided once.
- **Empty is an error.** If every product page fails to parse, the run exits `1` with
  "has the site changed?" rather than emitting `{ "results": [], "total": 0 }` with a partial-success
  code that a downstream job might accept.
- **Graceful shutdown.** SIGINT/SIGTERM abort in-flight requests and pending retries through one
  `AbortSignal`, so `docker stop` gets a prompt, clean exit instead of a hung container.
- **Guardrails, not policy.** `--max-pages` stops a mis-pointed `--url` from crawling a whole site;
  `--delay` bounds the request rate for hosts that need it. `robots.txt` is deliberately not
  consulted: this is a site published for scraping, and the flags exist for when that isn't true.
- **Minimal dependencies:** `cheerio` (HTML), `zod` (validation), `p-limit` (concurrency). CLI parsing
  uses Node's built-in `util.parseArgs`. No crawler framework: Crawlee and friends earn their weight
  with request queues, proxy rotation and browser pools — none of which a 150-page static site needs.

## Development

```bash
npm run dev            # run from source via tsx
npm test               # unit + integration tests (hermetic, no network)
npm run test:e2e       # live smoke test against the real site
npm run lint           # eslint + prettier
npm run typecheck
```

Tests are in three layers:

1. **Unit** — parser, expand and report against saved HTML fixtures in `tests/fixtures/` (a laptop
   with a disabled HDD option, a phone with colours, a tablet with both).
2. **Integration** — crawler and the full `scrape()` pipeline against an in-memory fake site that
   exercises categories, pagination, duplicates, out-of-scope links and a failing page.
3. **E2E** — `tests/e2e.test.ts` hits the real site and validates the report shape. It is excluded
   from `npm test` and runs as a separate CI job so a network blip never blocks a pull request.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, build, the e2e smoke test on pushes to
`main`, and a Docker build.

## When things go wrong

| Situation                                          | Behaviour                                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site unreachable, DNS failure, timeout             | Up to 4 attempts with backoff (500 ms → 2 s), then fatal, exit `1`, no output.                                                                                       |
| Transient 5xx/429 on some product pages            | Retried; if still failing, logged as `error`, report built from the rest, exit `2`.                                                                                  |
| A product page returns 404                         | Not retried (not transient); same as above, exit `2`.                                                                                                                |
| Product markup changes (name/price selectors miss) | Zod rejects the page. Every page failing → exit `1` with "has the site changed?".                                                                                    |
| Pagination or category markup changes              | Fewer pages discovered; visible as a drop in `productPages` in the summary line. This is the one silent failure mode — compare the summary against the previous run. |
| Site adds a category                               | Picked up automatically by the breadth-first crawl.                                                                                                                  |
| SIGINT / SIGTERM                                   | In-flight requests aborted, exit `130` / `143`.                                                                                                                      |

The parser is intentionally _not_ self-healing (multiple selector strategies, fuzzy matching):
that hides breakage instead of surfacing it. Breakage is cheap to fix precisely because all
selectors live in one file with fixture-based tests.

## Assumptions

- **`total` is the sum of every entry in `results`** (so a laptop with three HDD options contributes
  its price three times). The brief says "unique product prices", which could also be read as
  deduplicating equal prices; the illustrative example ("Sum of all prices in results") points to the
  former, and that is what is implemented. Changing it is a one-line edit in `src/report.ts`.
- Prices do not vary by HDD option on the static site, so every variant carries the page price.
- Variant names follow the brief's example: `"<name> <size> GB"`.

## Deliberately not built

- **Resumability / checkpointing.** A full run takes under ten seconds; restarting is cheaper
  than maintaining crawl state.
- **OpenTelemetry / metrics endpoint.** A one-shot CLI has nothing to trace; the JSON summary
  line is what a scheduler or log aggregator needs. Tracing becomes worthwhile if this turns into a
  long-running service.
- **Other output formats.** The brief asks for a single JSON object.
- **Snapshot tests of the live report.** Brittle by design; the e2e schema check catches markup
  drift without failing on every price change.

## Possible next steps

- Publish the image to GHCR from CI on tags, so deployment is `docker run ghcr.io/…`.
- Dependabot for dependency updates.
- A `--min-results <n>` threshold to turn the "fewer pages discovered" case above into a hard
  failure once a baseline is known.
