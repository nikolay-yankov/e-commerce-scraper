import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import type { FetchText } from './fetcher.js';

export interface CrawlOptions {
  startUrl: string;
  fetchText: FetchText;
  concurrency?: number;
  signal?: AbortSignal;
  /** Safety valve: abort rather than fetch more listing pages than this. */
  maxPages?: number;
  /** Called for every listing page fetched; useful for progress logging. */
  onPage?: (url: string) => void;
}

export interface CrawlResult {
  /** Unique product URLs, sorted for deterministic output. */
  productUrls: string[];
  /** Listing pages fetched. */
  listingPages: number;
}

const PRODUCT_PATH = /\/product\/\d+$/;

/**
 * Breadth-first crawl of every listing page reachable from `startUrl` that stays under
 * its path (categories, sub-categories, `?page=N`), collecting the unique product URLs.
 * Listing pages must be under the start path; product links only need the same origin, so
 * starting from a category page works.
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
}: CrawlOptions): Promise<CrawlResult> {
  const root = new URL(canonical(new URL(startUrl)));
  const limit = pLimit(concurrency);
  const visited = new Set<string>([root.href]);
  const products = new Set<string>();
  let frontier = [root.href];

  while (frontier.length > 0) {
    // `visited` already includes this level's pages, so this fires before fetching them.
    if (visited.size > maxPages) {
      throw new Error(`Crawl would exceed ${maxPages} listing pages`);
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
      const url = new URL(href);
      if (url.origin !== root.origin) continue;
      if (PRODUCT_PATH.test(url.pathname)) {
        products.add(href); // products may live beside the start path, e.g. /static/product/N
      } else if (isUnder(url, root) && !visited.has(href)) {
        visited.add(href);
        frontier.push(href);
      }
    }
  }

  return { productUrls: [...products].sort(), listingPages: visited.size };
}

/** Canonical absolute hrefs from every anchor on the page. Relative links are resolved. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    try {
      links.add(canonical(new URL(el.attribs['href'] ?? '', baseUrl)));
    } catch {
      // Not a valid URL at all — ignore. (Off-site links parse fine; isInScope drops them.)
    }
  });
  return [...links];
}

/** One string per page: no fragment, no trailing slash, so ".../static/" and ".../static" match. */
function canonical(url: URL): string {
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.href;
}

/** The root path itself or a descendant of it — not merely a string prefix like `/static-archive`. */
function isUnder(url: URL, root: URL): boolean {
  return url.pathname === root.pathname || url.pathname.startsWith(root.pathname + '/');
}
