import type { FastifyInstance } from "fastify";
import { AppError } from "../../app/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  createListingSchema,
  listListingsQuerySchema,
  publishListingParamsSchema,
} from "./listing.schemas.js";

import {
  createListing,
  getPublishedListings,
  publishListing,
} from "./listing.service.js";

export async function registerListingRoutes(app: FastifyInstance) {
  app.get("/listings", async (request, reply) => {
    const result = listListingsQuerySchema.safeParse(request.query);

    if (!result.success) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Please check the submitted query parameters.",
      );
    }

    const listings = await getPublishedListings(result.data);

    return reply.status(200).send(listings);
  });

  app.post(
  "/listings/:listingId/publish",
  { preHandler: requireAuth },
  async (request, reply) => {
    const result = publishListingParamsSchema.safeParse(request.params);

    if (!result.success) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "The listing ID is invalid.",
      );
    }

    const user = request.user;

    if (!user) {
      throw new AppError(
        401,
        "UNAUTHENTICATED",
        "Authentication is required.",
      );
    }

    const listing = await publishListing({
      listingId: result.data.listingId,
      sellerId: user.id,
    });

    return reply.status(200).send({
      listing,
    });
  },
);

  app.post(
    "/listings",
    { preHandler: requireAuth },
    async (request, reply) => {
      const result = createListingSchema.safeParse(request.body);

      if (!result.success) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "Please check the submitted fields.",
        );
      }

      const user = request.user;

      if (!user) {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication is required.",
        );
      }

      const listing = await createListing(user.id, result.data);

      return reply.status(201).send({
        listing,
      });
    },
  );
}