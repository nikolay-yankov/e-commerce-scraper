import { describe, expect, it, vi } from 'vitest';
import { createFetcher } from '../src/fetcher.js';

const response = (status: number, body = '') =>
  new Response(body, { status, headers: { 'content-type': 'text/html' } });

describe('createFetcher', () => {
  it('returns the body on success', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, '<html/>'));
    await expect(createFetcher({ fetch })('https://x.test')).resolves.toBe('<html/>');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and network errors, then succeeds', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(response(200, 'ok'));

    const promise = createFetcher({ fetch, retries: 3 })('https://x.test');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry on 404 and reports the real attempt count and cause', async () => {
    const fetch = vi.fn().mockResolvedValue(response(404));
    const promise = createFetcher({ fetch })('https://x.test');

    await expect(promise).rejects.toThrow('Failed to fetch https://x.test after 1 attempt(s)');
    await expect(promise).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'HTTP 404 for https://x.test' }),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('onRetry', () => {
  it('is called once per retry with the attempt number and cause', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200, 'ok'));
    const onRetry = vi.fn();

    const promise = createFetcher({ fetch, onRetry })('https://x.test');
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({
      url: 'https://x.test',
      attempt: 1,
      error: expect.objectContaining({ message: 'HTTP 500 for https://x.test' }),
    });
    vi.useRealTimers();
  });
});

describe('abort signal', () => {
  it('rejects without fetching when already aborted', async () => {
    const fetch = vi.fn();
    const signal = AbortSignal.abort(new Error('stop'));
    await expect(createFetcher({ fetch })('https://x.test', signal)).rejects.toThrow('stop');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects with the abort reason when aborted during an in-flight request, without retrying', async () => {
    const controller = new AbortController();
    const onRetry = vi.fn();
    // A fetch that never resolves on its own, only via the signal — like a stalled connection.
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );

    const promise = createFetcher({ fetch, onRetry })('https://x.test', controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort(new Error('stop'));

    await expect(promise).rejects.toThrow('stop');
    expect(onRetry).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry once aborted mid-backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(response(503));

    const promise = createFetcher({ fetch })('https://x.test', controller.signal);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error('stop'));
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('stop');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('delayMs', () => {
  it('waits before every request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(response(200, 'ok'));
    const promise = createFetcher({ fetch, delayMs: 500 })('https://x.test');

    await vi.advanceTimersByTimeAsync(499);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('ok');
    vi.useRealTimers();
  });
});
