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

    const { report, failures } = await scrape({ startUrl: ROOT, fetchText: site });

    expect(failures).toEqual([]);
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
