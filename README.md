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
npm start                         # JSON to stdout, progress to stderr
npm start -- -q -o output.json    # quiet, write to a file
```

Or with Docker:

```bash
docker build -t ecommerce-scraper .
docker run --rm ecommerce-scraper -q > output.json
```

### Options

```
-u, --url <url>          Start URL (default: the static test site)
-c, --concurrency <n>    Parallel requests (default: 5)
-o, --output <file>      Write JSON to a file instead of stdout
-q, --quiet              Suppress progress logging
-h, --help               Show help
```

Exit codes: `0` success · `1` fatal error (e.g. a listing page is unreachable) ·
`2` finished, but some product pages failed (they are listed on stderr; the report contains the rest).

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
- **Minimal dependencies:** `cheerio` (HTML), `zod` (validation), `p-limit` (concurrency). CLI parsing
  uses Node's built-in `util.parseArgs`.

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

## Assumptions

- **`total` is the sum of every entry in `results`** (so a laptop with three HDD options contributes
  its price three times). The brief says "unique product prices", which could also be read as
  deduplicating equal prices; the illustrative example ("Sum of all prices in results") points to the
  former, and that is what is implemented. Changing it is a one-line edit in `src/report.ts`.
- Prices do not vary by HDD option on the static site, so every variant carries the page price.
- Variant names follow the brief's example: `"<name> <size> GB"`.

## Trade-offs and future improvements

Kept within the 2-hour budget. With more time, in rough priority order:

- **Structured logging** (JSON lines with level/timestamp) instead of plain `console.error`, so logs
  can be ingested by a log aggregator when run on a schedule.
- **Rate limiting / politeness** beyond a concurrency cap — a per-host delay and `robots.txt`
  awareness — if this were pointed at a site we don't own.
- **Resumability**: persist discovered URLs so a crashed run can continue rather than restart.
- **Observability**: a summary line (pages fetched, retries, duration) and optional OpenTelemetry
  spans if this became a long-running service.
- **Output formats** (`--format csv|ndjson`) — cheap to add but not asked for.
- **Snapshot tests** of the full live report to catch upstream markup changes early.
