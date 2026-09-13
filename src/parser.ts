import * as cheerio from 'cheerio';
import { ProductPageSchema, type ProductPage } from './schema.js';

/**
 * Parses a product page's HTML into a ProductPage.
 * All knowledge of the site's markup lives here; if the site changes, this is the only file to touch.
 * Selectors use the page's schema.org microdata where possible — more stable than CSS classes.
 */
export function parseProductPage(html: string): ProductPage {
  const $ = cheerio.load(html);
  const product = $('[itemtype="https://schema.org/Product"]').first();

  const text = (selector: string) => product.find(selector).first().text().trim();
  const attrValues = (selector: string, attr: string) =>
    product
      .find(selector)
      .map((_, el) => $(el).attr(attr)?.trim() ?? '')
      .get()
      .filter((value) => value !== '');

  return ProductPageSchema.parse({
    name: text('[itemprop="name"]'),
    description: text('[itemprop="description"]'),
    price: parsePrice(text('[itemprop="price"]')),
    // Disabled swatches are options the shop does not currently offer.
    hddOptions: attrValues('button.swatch:not([disabled])', 'value'),
    // The first <option> is a "Select color" placeholder with an empty value.
    colors: attrValues('select[aria-label="color"] option', 'value'),
  });
}

/** "$1,178.19" -> 1178.19. Keeps digits and the decimal point; throws if nothing numeric is left. */
export function parsePrice(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const value = Number(cleaned);
  if (cleaned === '' || Number.isNaN(value)) {
    throw new Error(`Unparseable price: "${text.trim()}"`);
  }
  return value;
}
