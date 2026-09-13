import { describe, expect, it } from 'vitest';
import { scrape } from '../src/scrape.js';
import { fakeSite, links, productHtml } from './helpers.js';

const ROOT = 'https://shop.test/static';

describe('scrape', () => {
  it('runs the full pipeline and builds a report', async () => {
    const site = fakeSite({
      [ROOT]: links('/static/product/1', '/static/product/2'),
      [`${ROOT}/product/1`]: productHtml(
        'Laptop',
        '$100.50',
        '<button class="btn swatch" value="128">128</button><button class="btn swatch" value="256">256</button>',
      ),
      [`${ROOT}/product/2`]: productHtml(
        'Phone',
        '$9.99',
        '<select aria-label="color"><option value="">Pick</option><option value="Red">Red</option><option value="Blue">Blue</option></select>',
      ),
    });

    const { report, failures, stats } = await scrape({ startUrl: ROOT, fetchText: site });

    expect(failures).toEqual([]);
    expect(stats).toMatchObject({ listingPages: 1, productPages: 2 });
    expect(report).toEqual({
      results: [
        { name: 'Laptop 128 GB', description: 'desc', price: 100.5 },
        { name: 'Laptop 256 GB', description: 'desc', price: 100.5 },
        { name: 'Phone', description: 'desc', price: 9.99, colors: ['Red', 'Blue'] },
      ],
      total: 210.99,
    });
  });

  it('reports failed product pages but still returns the rest', async () => {
    const site = fakeSite({
      [ROOT]: links('/static/product/1', '/static/product/2'),
      [`${ROOT}/product/1`]: productHtml('Ok', '$1'),
    });

    const { report, failures } = await scrape({ startUrl: ROOT, fetchText: site });

    expect(report.results.map((p) => p.name)).toEqual(['Ok']);
    expect(failures.map((f) => f.url)).toEqual([`${ROOT}/product/2`]);
  });
});

describe('scrape abort', () => {
  it('rejects with the abort reason instead of reporting every product as failed', async () => {
    const controller = new AbortController();
    const site = fakeSite({
      [ROOT]: links('/static/product/1', '/static/product/2'),
      [`${ROOT}/product/1`]: productHtml('A', '$1'),
      [`${ROOT}/product/2`]: productHtml('B', '$1'),
    });
    const fetchText = async (url: string, signal?: AbortSignal) => {
      if (url.endsWith('/product/1')) controller.abort(new Error('stop'));
      signal?.throwIfAborted();
      return site(url);
    };

    await expect(scrape({ startUrl: ROOT, fetchText, signal: controller.signal })).rejects.toThrow(
      'stop',
    );
  });
});

describe('scrape maxPages', () => {
  it('fails before fetching products when listing + product pages exceed the budget', async () => {
    const site = fakeSite({
      [ROOT]: links('/static/product/1', '/static/product/2'),
      [`${ROOT}/product/1`]: productHtml('A', '$1'),
      [`${ROOT}/product/2`]: productHtml('B', '$1'),
    });

    await expect(scrape({ startUrl: ROOT, fetchText: site, maxPages: 2 })).rejects.toThrow(
      /3 pages, over the limit of 2/,
    );
    expect(site.calls).toEqual([ROOT]);
  });
});

describe('scrape with nothing usable', () => {
  it('fails instead of returning an empty report when every product page fails', async () => {
    const site = fakeSite({
      [ROOT]: links('/static/product/1', '/static/product/2'),
      [`${ROOT}/product/1`]: '<html>layout changed</html>',
    });

    await expect(scrape({ startUrl: ROOT, fetchText: site })).rejects.toThrow(
      /No products scraped \(2 page\(s\) failed\)/,
    );
  });
});
