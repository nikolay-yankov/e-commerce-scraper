import { readFileSync } from 'node:fs';
import type { FetchFn, FetchText } from '../src/fetcher.js';

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

type Pages = Record<string, string>;

/** A `fetch` serving an in-memory map of URL → HTML. Unknown URLs get a 404. */
export function fakeFetch(pages: Pages): FetchFn & { calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchFn = async (input) => {
    const url = String(input);
    calls.push(url);
    const html = pages[url];
    return new Response(html ?? 'not found', { status: html === undefined ? 404 : 200 });
  };
  return Object.assign(fetch, { calls });
}

/** The same fake site one level up: a `fetchText` that rejects on 404 like the real one does. */
export function fakeSite(pages: Pages): FetchText & { calls: string[] } {
  const fetch = fakeFetch(pages);
  const fetchText: FetchText = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  };
  return Object.assign(fetchText, { calls: fetch.calls });
}

export const links = (...hrefs: string[]) =>
  `<html><body>${hrefs.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`;

export const productHtml = (name: string, price: string, extra = '') => `
  <div itemtype="https://schema.org/Product">
    <span itemprop="price">${price}</span>
    <h4 itemprop="name">${name}</h4>
    <p itemprop="description">desc</p>
    ${extra}
  </div>`;
