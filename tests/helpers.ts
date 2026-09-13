import { readFileSync } from 'node:fs';
import type { FetchText } from '../src/fetcher.js';

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** A `fetchText` backed by an in-memory map of URL → HTML. Unknown URLs reject like a 404 would. */
export function fakeSite(pages: Record<string, string>): FetchText & { calls: string[] } {
  const calls: string[] = [];
  const fetchText = async (url: string) => {
    calls.push(url);
    const html = pages[url];
    if (html === undefined) throw new Error(`HTTP 404 for ${url}`);
    return html;
  };
  return Object.assign(fetchText, { calls });
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
