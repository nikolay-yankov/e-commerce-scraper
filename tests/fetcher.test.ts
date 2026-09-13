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

  it('does not retry on 404', async () => {
    const fetch = vi.fn().mockResolvedValue(response(404));
    await expect(createFetcher({ fetch })('https://x.test')).rejects.toThrow(/Failed to fetch/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
