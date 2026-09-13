import { describe, expect, it } from 'vitest';
import { expandVariants } from '../src/expand.js';

const base = { name: 'Laptop', description: 'd', price: 10, hddOptions: [], colors: [] };

describe('expandVariants', () => {
  it('returns one product when there are no options', () => {
    expect(expandVariants(base)).toEqual([{ name: 'Laptop', description: 'd', price: 10 }]);
  });

  it('creates one product per HDD option with the size in the name', () => {
    const products = expandVariants({ ...base, hddOptions: ['128', '256'] });
    expect(products.map((p) => p.name)).toEqual(['Laptop 128 GB', 'Laptop 256 GB']);
    expect(products.every((p) => p.price === 10)).toBe(true);
  });

  it('includes colors only when more than one is available', () => {
    expect(expandVariants({ ...base, colors: ['Black'] })[0]).not.toHaveProperty('colors');
    expect(expandVariants({ ...base, colors: ['Black', 'Gold'] })[0]?.colors).toEqual([
      'Black',
      'Gold',
    ]);
  });

  it('applies colors to every HDD variant', () => {
    const products = expandVariants({ ...base, hddOptions: ['128', '256'], colors: ['A', 'B'] });
    expect(products).toHaveLength(2);
    expect(products.every((p) => p.colors?.length === 2)).toBe(true);
  });
});
