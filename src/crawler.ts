import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import type { FetchText } from './fetcher.js';

export interface CrawlOptions {
  fetchText: FetchText;
  concurrency?: number;
  signal?: AbortSignal | undefined;
  /** Safety valve: abort rather than fetch more listing pages than this. */
  maxPages?: number;
  /** Called for every listing page fetched; useful for progress logging. */
  onPage?: (url: string) => void;
}

const PRODUCT_PATH = /\/product\/\d+$/;

/**
 * Breadth-first crawl of every listing page reachable from `startUrl` that stays under
 * its path (categories, sub-categories, `?page=N`), collecting the unique product URLs.
 *
 * Product pages themselves are not fetched here — that is the caller's job — so the crawl
 * touches each listing page exactly once regardless of how many products link back to it.
 */
export async function discoverProductUrls({
  startUrl,
  fetchText,
  concurrency = 5,
  signal,
  maxPages = Infinity,
  onPage,
}: CrawlOptions & { startUrl: string }): Promise<string[]> {
  const root = new URL(startUrl);
  const limit = pLimit(concurrency);
  const visited = new Set<string>([root.href]);
  const products = new Set<string>();
  let frontier = [root.href];

  while (frontier.length > 0) {
    if (visited.size > maxPages) {
      throw new Error(`Crawl would exceed ${maxPages} listing pages (see --max-pages)`);
    }
    const pages = await Promise.all(
      frontier.map((url) =>
        limit(async () => {
          onPage?.(url);
          return extractLinks(await fetchText(url, signal), url);
        }),
      ),
    );

    frontier = [];
    for (const href of pages.flat()) {
      if (!isInScope(href, root)) continue;
      if (PRODUCT_PATH.test(new URL(href).pathname)) {
        products.add(href);
      } else if (!visited.has(href)) {
        visited.add(href);
        frontier.push(href);
      }
    }
  }

  return [...products].sort();
}

/** Absolute, hash-free hrefs from every anchor on the page. Relative links are resolved. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    try {
      const url = new URL($(el).attr('href')!, baseUrl);
      url.hash = '';
      links.add(url.href);
    } catch {
      // Malformed href (e.g. "javascript:void(0)") — ignore.
    }
  });
  return [...links];
}

function isInScope(href: string, root: URL): boolean {
  const url = new URL(href);
  return url.origin === root.origin && url.pathname.startsWith(root.pathname);
}
