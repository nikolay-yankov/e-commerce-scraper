import { describe, expect, it } from 'vitest';
import { discoverProductUrls, extractLinks } from '../src/crawler.js';
import { fakeSite, links } from './helpers.js';

const ROOT = 'https://shop.test/static';

describe('discoverProductUrls', () => {
  it('follows categories and pagination, dedupes products, and ignores out-of-scope links', async () => {
    const site = fakeSite({
      [ROOT]: links(
        '/static/laptops',
        '/static/product/1',
        '/about',
        '/static-archive/laptops',
        'https://other.test/x',
      ),
      [`${ROOT}/laptops`]: links(
        '/static/laptops?page=2',
        '/static/product/1',
        '/static/product/2',
      ),
      [`${ROOT}/laptops?page=2`]: links('/static/laptops', '/static/product/3#reviews'),
    });

    const { productUrls, listingPages } = await discoverProductUrls({
      startUrl: ROOT,
      fetchText: site,
    });

    expect(productUrls).toEqual([`${ROOT}/product/1`, `${ROOT}/product/2`, `${ROOT}/product/3`]);
    expect(listingPages).toBe(3);
    expect(site.calls.sort()).toEqual([ROOT, `${ROOT}/laptops`, `${ROOT}/laptops?page=2`]);
  });

  it('treats a trailing slash on the start URL as the same page', async () => {
    const site = fakeSite({
      [ROOT]: links('/static', '/static/', '/static/product/1'),
    });

    const { productUrls, listingPages } = await discoverProductUrls({
      startUrl: `${ROOT}/`,
      fetchText: site,
    });

    expect(productUrls).toEqual([`${ROOT}/product/1`]);
    expect(listingPages).toBe(1);
    expect(site.calls).toEqual([ROOT]);
  });

  it('collects product links beside the start path, so a category page works as a start', async () => {
    const site = fakeSite({
      [`${ROOT}/phones`]: links('/static/product/7', '/static/laptops', '/static/phones?page=2'),
      [`${ROOT}/phones?page=2`]: links('/static/product/8'),
    });

    const { productUrls, listingPages } = await discoverProductUrls({
      startUrl: `${ROOT}/phones`,
      fetchText: site,
    });

    expect(productUrls).toEqual([`${ROOT}/product/7`, `${ROOT}/product/8`]);
    expect(listingPages).toBe(2); // /static/laptops is a sibling, not under /static/phones
  });

  it('fails loudly when a listing page cannot be fetched', async () => {
    const site = fakeSite({ [ROOT]: links('/static/missing') });
    await expect(discoverProductUrls({ startUrl: ROOT, fetchText: site })).rejects.toThrow(/404/);
  });
});

describe('extractLinks', () => {
  it('resolves relative hrefs, strips hashes and trailing slashes, and dedupes', () => {
    const html = links('/a', 'a', '/a#x', '/a/', 'javascript:void(0)');
    expect(extractLinks(html, 'https://shop.test/dir/page')).toEqual([
      'https://shop.test/a',
      'https://shop.test/dir/a',
      'javascript:void(0)',
    ]);
  });
});

describe('maxPages', () => {
  it('aborts before fetching a level that would exceed the budget', async () => {
    const site = fakeSite({
      [ROOT]: links('/static/a', '/static/b'),
      [`${ROOT}/a`]: links(),
      [`${ROOT}/b`]: links(),
    });

    await expect(
      discoverProductUrls({ startUrl: ROOT, fetchText: site, maxPages: 2 }),
    ).rejects.toThrow(/exceed 2 listing pages/);
    expect(site.calls).toEqual([ROOT]);
  });
});
