import pLimit from 'p-limit';
import { discoverProductUrls } from './crawler.js';
import { expandVariants } from './expand.js';
import type { FetchText } from './fetcher.js';
import { parseProductPage } from './parser.js';
import { buildReport } from './report.js';
import type { Report } from './schema.js';

export interface ScrapeOptions {
  startUrl: string;
  fetchText: FetchText;
  concurrency?: number;
  log?: (message: string) => void;
}

export interface ScrapeResult {
  report: Report;
  /** Product URLs that could not be fetched or parsed. The report is still built from the rest. */
  failures: { url: string; error: unknown }[];
}

/** The whole pipeline: discover → fetch → parse → expand → report. Pure apart from `fetchText`. */
export async function scrape({
  startUrl,
  fetchText,
  concurrency = 5,
  log = () => {},
}: ScrapeOptions): Promise<ScrapeResult> {
  const productUrls = await discoverProductUrls({
    startUrl,
    fetchText,
    concurrency,
    onPage: (url) => log(`listing  ${url}`),
  });
  log(`found ${productUrls.length} product pages`);

  const limit = pLimit(concurrency);
  const settled = await Promise.allSettled(
    productUrls.map((url) =>
      limit(async () => {
        log(`product  ${url}`);
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

  return { report: buildReport(products), failures };
}
