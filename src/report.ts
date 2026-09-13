import { ReportSchema, type Product, type Report } from './schema.js';

/**
 * Builds the final output. Prices are summed in integer cents to avoid
 * floating-point drift (0.1 + 0.2 !== 0.3), then converted back once.
 */
export function buildReport(products: Product[]): Report {
  const totalCents = products.reduce((sum, p) => sum + Math.round(p.price * 100), 0);
  return ReportSchema.parse({ results: products, total: totalCents / 100 });
}
