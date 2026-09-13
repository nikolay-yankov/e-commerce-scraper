import { setTimeout as sleep } from 'node:timers/promises';

export type FetchFn = typeof globalThis.fetch;

export interface FetcherOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  retries?: number;
  /** Base for exponential backoff between retries: base × 2^attempt. */
  backoffMs?: number;
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
  backoffMs = 250,
  delayMs = 0,
  userAgent = 'ecommerce-scraper/1.0 (+https://github.com/nikolay-yankov/e-commerce-scraper)',
  onRetry = () => {},
}: FetcherOptions = {}): FetchText {
  return async function fetchText(url, signal) {
    let lastError: unknown;
    let attempts = 0;

    while (attempts <= retries) {
      if (attempts > 0) {
        onRetry({ url, attempt: attempts, error: lastError });
        await pause(backoffMs * 2 ** attempts, signal); // 500, 1000, 2000, …
      }
      await pause(delayMs, signal);
      attempts++;

      try {
        const res = await fetch(url, {
          headers: { 'user-agent': userAgent, accept: 'text/html' },
          signal: withTimeout(signal, timeoutMs),
        });
        if (res.ok) return await res.text();

        await res.body?.cancel(); // release the connection; we only care about the status
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        if (!RETRYABLE_STATUS.has(res.status)) break;
      } catch (err) {
        if (signal?.aborted) throw signal.reason; // caller cancelled: not a network error
        lastError = err; // network error or timeout: worth a retry
      }
    }

    throw new Error(`Failed to fetch ${url} after ${attempts} attempt(s)`, { cause: lastError });
  };
}

/** Sleeps for `ms`, but wakes up immediately (and throws the reason) if `signal` is aborted. */
async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms > 0) await sleep(ms, undefined, { signal }).catch(() => signal?.throwIfAborted());
}

/** A signal that fires on caller abort *or* timeout, whichever comes first. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
