import { z } from "zod";

export const createListingSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(5000),
  price: z.number().nonnegative(),
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "USED"]),
  location: z.string().trim().min(1).max(120),
}).strict();

export const listListingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
}).strict();

export const publishListingParamsSchema = z.object({
  listingId: z.string().uuid(),
}).strict();

export const listingParamsSchema = z.object({
  listingId: z.string().uuid(),
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