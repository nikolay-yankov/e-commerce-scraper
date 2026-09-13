/**
 * Live smoke test against the real site. Network-dependent, so it is excluded from
 * `npm test` and run explicitly with `npm run test:e2e`.
 */
import { describe, expect, it } from 'vitest';
import { createFetcher } from '../src/fetcher.js';
import { scrape } from '../src/scrape.js';
import { ReportSchema } from '../src/schema.js';

describe('live site', () => {
  it('scrapes a valid, non-empty report', { timeout: 60_000 }, async () => {
    const { report, failures } = await scrape({
      startUrl: 'https://webscraper.io/test-sites/e-commerce/static',
      fetchText: createFetcher(),
    });

    expect(failures).toEqual([]);
    expect(ReportSchema.safeParse(report).success).toBe(true);
    expect(report.results.length).toBeGreaterThan(100);
    expect(report.results.some((p) => / \d+ GB$/.test(p.name))).toBe(true);
    expect(report.results.some((p) => p.colors)).toBe(true);
  });
});
