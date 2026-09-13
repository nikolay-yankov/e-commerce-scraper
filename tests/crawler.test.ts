import { describe, expect, it } from 'vitest';
import { discoverProductUrls, extractLinks } from '../src/crawler.js';
import { fakeSite, links } from './helpers.js';

const ROOT = 'https://shop.test/static';

describe('discoverProductUrls', () => {
  it('follows categories and pagination, dedupes products, and ignores out-of-scope links', async () => {
    const site = fakeSite({
      [ROOT]: links('/static/laptops', '/static/product/1', '/about', 'https://other.test/x'),
      [`${ROOT}/laptops`]: links(
        '/static/laptops?page=2',
        '/static/product/1',
        '/static/product/2',
      ),
      [`${ROOT}/laptops?page=2`]: links('/static/laptops', '/static/product/3#reviews'),
    });

    const urls = await discoverProductUrls({ startUrl: ROOT, fetchText: site });

    expect(urls).toEqual([`${ROOT}/product/1`, `${ROOT}/product/2`, `${ROOT}/product/3`]);
    expect(site.calls.sort()).toEqual([ROOT, `${ROOT}/laptops`, `${ROOT}/laptops?page=2`]);
  });

  it('fails loudly when a listing page cannot be fetched', async () => {
    const site = fakeSite({ [ROOT]: links('/static/missing') });
    await expect(discoverProductUrls({ startUrl: ROOT, fetchText: site })).rejects.toThrow(/404/);
  });
});

describe('extractLinks', () => {
  it('resolves relative hrefs, strips hashes and dedupes', () => {
    const html = links('/a', 'a', '/a#x', 'javascript:void(0)');
    expect(extractLinks(html, 'https://shop.test/dir/page')).toEqual([
      'https://shop.test/a',
      'https://shop.test/dir/a',
      'javascript:void(0)',
    ]);
  });
});
