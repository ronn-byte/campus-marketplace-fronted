import { z } from "zod";

export const MAX_LISTING_PRICE = 9_999_999_999.99;

export const createListingSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(5000),
  price: z.number().finite().min(0).max(MAX_LISTING_PRICE),
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "USED"]),
  location: z.string().trim().min(1).max(120),
}).strict();

export const listListingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
}).strict();

// Cap offset pagination at 100,000 rows: at pageSize 50 this is page 2,001.
export const MAX_PUBLIC_LISTING_PAGE = 2_001;
export const MAX_PUBLIC_LISTING_OFFSET = 100_000;

const optionalTrimmedQuery = (max: number) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(max).optional(),
);

const optionalPriceQuery = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce.number().finite().nonnegative().optional(),
);

export const listPublicListingsQuerySchema = z.object({
  ...listListingsQuerySchema.shape,
  page: z.coerce.number().int().positive().max(MAX_PUBLIC_LISTING_PAGE)
    .refine(Number.isSafeInteger, "Page must be a safe integer.").default(1),
  q: optionalTrimmedQuery(120),
  categoryId: z.string().uuid().optional(),
  minPrice: optionalPriceQuery,
  maxPrice: optionalPriceQuery,
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "USED"]).optional(),
  location: optionalTrimmedQuery(120),
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
}).strict().superRefine((query, context) => {
  const offset = (query.page - 1) * query.pageSize;
  if (!Number.isSafeInteger(offset) || offset > MAX_PUBLIC_LISTING_OFFSET) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["page"],
      message: "The requested page is outside the supported range.",
    });
  }
  if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxPrice"],
      message: "Maximum price must be greater than or equal to minimum price.",
    });
  }
});

export const publishListingParamsSchema = z.object({
  listingId: z.string().uuid(),
}).strict();

export const listingParamsSchema = z.object({
  listingId: z.string().uuid(),
}).strict();

export const listingImageParamsSchema = z.object({
  listingId: z.string().uuid(),
  imageId: z.string().uuid(),
}).strict();

export const createListingInquirySchema = z.object({
  message: z.string().trim().min(1).max(2000),
}).strict();

export const listingInquiryParamsSchema = z.object({
  listingId: z.string().uuid(),
  inquiryId: z.string().uuid(),
}).strict();

export const updateInquiryStatusSchema = z.object({
  status: z.enum(["RESPONDED", "CLOSED"]),
}).strict();

export const updateListingSchema = createListingSchema
  .partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0);
