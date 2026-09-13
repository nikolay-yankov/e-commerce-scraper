import pLimit from 'p-limit';
import { discoverProductUrls } from './crawler.js';
import { expandVariants } from './expand.js';
import type { FetchText } from './fetcher.js';
import { silentLogger, type Logger } from './logger.js';
import { parseProductPage } from './parser.js';
import { buildReport } from './report.js';
import type { Product, Report } from './schema.js';

export interface ScrapeOptions {
  startUrl: string;
  fetchText: FetchText;
  concurrency?: number;
  logger?: Logger;
  /** Aborting cancels in-flight requests and rejects the scrape; nothing partial is returned. */
  signal?: AbortSignal;
  /** Upper bound on pages fetched (listing + product). Exceeding it is a fatal error. */
  maxPages?: number;
}

export interface ScrapeResult {
  report: Report;
  /** Product URLs that could not be fetched or parsed. The report is still built from the rest. */
  failures: { url: string; error: unknown }[];
  stats: { listingPages: number; productPages: number; durationMs: number };
}

/** The whole pipeline: discover → fetch → parse → expand → report. Pure apart from `fetchText`. */
export async function scrape({
  startUrl,
  fetchText,
  concurrency = 5,
  logger = silentLogger,
  signal,
  maxPages = Infinity,
}: ScrapeOptions): Promise<ScrapeResult> {
  const startedAt = performance.now();

  const { productUrls, listingPages } = await discoverProductUrls({
    startUrl,
    fetchText,
    concurrency,
    signal,
    maxPages,
    onPage: (url) => logger.debug('listing page', { url }),
  });
  logger.info('discovery complete', { listingPages, productPages: productUrls.length });

  const totalPages = listingPages + productUrls.length;
  if (totalPages > maxPages) {
    throw new Error(`Crawl would fetch ${totalPages} pages, over the limit of ${maxPages}`);
  }

  const limit = pLimit(concurrency);
  const settled = await Promise.allSettled(
    productUrls.map((url) =>
      limit(async () => {
        signal?.throwIfAborted(); // queued tasks still run after an abort; skip them quietly
        logger.debug('product page', { url });
        return expandVariants(parseProductPage(await fetchText(url, signal)));
      }),
    ),
  );

  // An abort shows up as N rejected product fetches; surface it as the single cause it is.
  signal?.throwIfAborted();

  const products: Product[] = [];
  const failures: ScrapeResult['failures'] = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') products.push(...result.value);
    else failures.push({ url: productUrls[i]!, error: result.reason });
  });

  // Every page failing is not a "partial success" — the site has almost certainly changed.
  if (products.length === 0) {
    throw new Error(
      `No products scraped (${failures.length} page(s) failed); has the site changed?`,
    );
  }

  return {
    report: buildReport(products),
    failures,
    stats: {
      listingPages,
      productPages: productUrls.length,
      durationMs: Math.round(performance.now() - startedAt),
    },
  };
}
