import type { Product, ProductPage } from './schema.js';

/**
 * Turns one scraped page into the products it represents.
 * - Each available HDD option becomes its own product, e.g. "Dell Latitude 5580 128 GB".
 * - `colors` is only emitted when there is a genuine choice (more than one colour).
 */
export function expandVariants(page: ProductPage): Product[] {
  const base: Product = { name: page.name, description: page.description, price: page.price };
  if (page.colors.length > 1) base.colors = page.colors;

  if (page.hddOptions.length === 0) return [base];

  return page.hddOptions.map((hdd) => ({ ...base, name: `${base.name} ${hdd} GB` }));
}
