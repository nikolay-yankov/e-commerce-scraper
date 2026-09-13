import { setTimeout as sleep } from 'node:timers/promises';

export type FetchFn = typeof globalThis.fetch;

export interface FetcherOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
}

export type FetchText = (url: string) => Promise<string>;

/** Retry on network errors and on server-side/rate-limit statuses; anything else is our fault. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Creates a `fetchText(url)` function with a timeout, exponential-backoff retries and a polite UA.
 * The underlying `fetch` is injectable so the crawler can be tested without a network.
 */
export function createFetcher({
  fetch = globalThis.fetch,
  timeoutMs = 10_000,
  retries = 3,
  userAgent = 'ecommerce-scraper/1.0 (+https://github.com/)',
}: FetcherOptions = {}): FetchText {
  return async function fetchText(url) {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(2 ** attempt * 250);
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': userAgent, accept: 'text/html' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return await res.text();
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        if (!RETRYABLE_STATUS.has(res.status)) break;
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`Failed to fetch ${url} after ${retries + 1} attempt(s)`, { cause: lastError });
  };
}
