import { z } from 'zod';

/** What a single product page yields, before HDD variants are expanded. */
export const ProductPageSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  price: z.number().nonnegative(),
  /** Available (non-disabled) storage options, e.g. ["128", "256"]. Empty when none. */
  hddOptions: z.array(z.string()),
  /** Colour options. Empty when the product has no colour selector. */
  colors: z.array(z.string()),
});
export type ProductPage = z.infer<typeof ProductPageSchema>;

/** One entry in the final `results` array. */
export const ProductSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  price: z.number().nonnegative(),
  colors: z.array(z.string()).min(2).optional(),
});
export type Product = z.infer<typeof ProductSchema>;

/** The CLI's only output. */
export const ReportSchema = z.object({
  results: z.array(ProductSchema),
  total: z.number().nonnegative(),
});
export type Report = z.infer<typeof ReportSchema>;
