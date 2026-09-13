import * as cheerio from 'cheerio';
import { ProductPageSchema, type ProductPage } from './schema.js';

/**
 * Parses a product page's HTML into a ProductPage.
 * All knowledge of the site's markup lives here; if the site changes, this is the only file to touch.
 */
export function parseProductPage(html: string): ProductPage {
  const $ = cheerio.load(html);
  const product = $('[itemtype="https://schema.org/Product"]').first();

  return ProductPageSchema.parse({
    name: product.find('[itemprop="name"]').first().text().trim(),
    description: product.find('[itemprop="description"]').first().text().trim(),
    price: parsePrice(product.find('[itemprop="price"]').first().text()),
    hddOptions: product
      .find('button.swatch:not([disabled])')
      .map((_, el) => $(el).attr('value')?.trim() ?? '')
      .get()
      .filter(Boolean),
    colors: product
      .find('select[aria-label="color"] option')
      .map((_, el) => $(el).attr('value')?.trim() ?? '')
      .get()
      .filter(Boolean),
  });
}

/** "$1,178.19" -> 1178.19. Throws on anything that isn't a price. */
export function parsePrice(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const value = Number(cleaned);
  if (cleaned === '' || Number.isNaN(value)) {
    throw new Error(`Unparseable price: "${text.trim()}"`);
  }
  return value;
}
