import { setTimeout as sleep } from 'node:timers/promises';

export type FetchFn = typeof globalThis.fetch;

export interface FetcherOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  retries?: number;
  /** Pause before every request. Combined with `concurrency`, this bounds the request rate. */
  delayMs?: number;
  userAgent?: string;
  /** Called before each retry; lets the caller log or count them. */
  onRetry?: (info: { url: string; attempt: number; error: unknown }) => void;
}

export type FetchText = (url: string, signal?: AbortSignal) => Promise<string>;

/** Retry on network errors and on server-side/rate-limit statuses; anything else is our fault. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Creates a `fetchText(url, signal?)` function with a timeout, exponential-backoff retries and a
 * polite UA. An aborted `signal` cancels the in-flight request and suppresses further retries.
 * The underlying `fetch` is injectable so the crawler can be tested without a network.
 */
export function createFetcher({
  fetch = globalThis.fetch,
  timeoutMs = 10_000,
  retries = 3,
  delayMs = 0,
  userAgent = 'ecommerce-scraper/1.0 (+https://github.com/nikolay-yankov/e-commerce-scraper)',
  onRetry = () => {},
}: FetcherOptions = {}): FetchText {
  return async function fetchText(url, signal) {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      signal?.throwIfAborted();
      if (attempt > 0) {
        onRetry({ url, attempt, error: lastError });
        await sleep(2 ** attempt * 250, undefined, { signal }).catch(() =>
          signal?.throwIfAborted(),
        );
      }
      if (delayMs > 0)
        await sleep(delayMs, undefined, { signal }).catch(() => signal?.throwIfAborted());
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': userAgent, accept: 'text/html' },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
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
