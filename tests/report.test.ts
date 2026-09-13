import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/report.js';

const product = (price: number) => ({ name: 'p', description: '', price });

describe('buildReport', () => {
  it('sums prices without floating-point drift', () => {
    expect(buildReport([product(0.1), product(0.2)]).total).toBe(0.3);
    expect(buildReport([product(1178.19), product(93.99)]).total).toBe(1272.18);
  });

  it('produces an empty report for no products', () => {
    expect(buildReport([])).toEqual({ results: [], total: 0 });
  });
});
