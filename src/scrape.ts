import pLimit from 'p-limit';
import { discoverProductUrls } from './crawler.js';
import { expandVariants } from './expand.js';
import type { FetchText } from './fetcher.js';
import { silentLogger, type Logger } from './logger.js';
import { parseProductPage } from './parser.js';
import { buildReport } from './report.js';
import type { Report } from './schema.js';

export interface ScrapeOptions {
  startUrl: string;
  fetchText: FetchText;
  concurrency?: number;
  logger?: Logger;
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
}: ScrapeOptions): Promise<ScrapeResult> {
  const startedAt = performance.now();
  let listingPages = 0;

  const productUrls = await discoverProductUrls({
    startUrl,
    fetchText,
    concurrency,
    onPage: (url) => {
      listingPages++;
      logger.debug('listing page', { url });
    },
  });
  logger.info('discovery complete', { listingPages, productPages: productUrls.length });

  const limit = pLimit(concurrency);
  const settled = await Promise.allSettled(
    productUrls.map((url) =>
      limit(async () => {
        logger.debug('product page', { url });
        return expandVariants(parseProductPage(await fetchText(url)));
      }),
    ),
  );

  const failures: ScrapeResult['failures'] = [];
  const products = settled.flatMap((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    failures.push({ url: productUrls[i]!, error: result.reason });
    return [];
  });

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
