import { describe, expect, it } from 'vitest';
import { parsePrice, parseProductPage } from '../src/parser.js';
import { fixture, productHtml } from './helpers.js';

describe('parseProductPage', () => {
  it('parses a laptop with HDD options and skips disabled ones', () => {
    expect(parseProductPage(fixture('product-laptop-hdd.html'))).toEqual({
      name: 'Dell Vostro 15',
      description:
        'Dell Vostro 15 (3568) Black, 15.6" FHD, Core i5-7200U, 4GB, 128GB SSD, Radeon R5 M420 2GB, Linux',
      price: 488.78,
      hddOptions: ['128', '256', '512'],
      colors: [],
    });
  });

  it('parses a phone with colours and no HDD options, ignoring the placeholder option', () => {
    expect(parseProductPage(fixture('product-phone-colors.html'))).toEqual({
      name: 'Nokia 123',
      description: '7 day battery',
      price: 24.99,
      hddOptions: [],
      colors: ['Gold', 'White', 'Black'],
    });
  });

  it('parses a tablet with both HDD options and colours', () => {
    const page = parseProductPage(fixture('product-tablet-hdd-colors.html'));
    expect(page.name).toBe('MeMO Pad 7');
    expect(page.hddOptions).toEqual(['128', '256', '512']);
    expect(page.colors).toEqual(['Gold', 'White', 'Black']);
  });

  it('rejects a page without a product name', () => {
    expect(() => parseProductPage(productHtml('', '$1'))).toThrow();
  });
});

describe('parsePrice', () => {
  it.each([
    ['$1178.19', 1178.19],
    ['$1399', 1399],
    ['$1,234.50', 1234.5],
    ['  $0.99 ', 0.99],
  ])('parses %s → %s', (text, expected) => {
    expect(parsePrice(text)).toBe(expected);
  });

  it('throws on non-numeric text', () => {
    expect(() => parsePrice('N/A')).toThrow(/Unparseable price/);
    expect(() => parsePrice('')).toThrow(/Unparseable price/);
  });
});
