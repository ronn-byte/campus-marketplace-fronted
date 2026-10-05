import type { FastifyInstance } from "fastify";
import { AppError } from "../../app/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  createListingInquirySchema,
  createListingSchema,
  listingInquiryParamsSchema,
  listingParamsSchema,
  listListingsQuerySchema,
  publishListingParamsSchema,
  updateInquiryStatusSchema,
  updateListingSchema,
} from "./listing.schemas.js";

import {
  addListingImages,
  createListingInquiry,
  createListing,
  getBuyerInquiries,
  getListingCategories,
  getListingInquiries,
  getPublicListing,
  getPublishedListings,
  getSellerListings,
  markListingSold,
  publishListing,
  releaseListingReservation,
  reserveListing,
  removeListing,
  updateInquiryStatus,
  updateListing,
} from "./listing.service.js";

export async function registerListingRoutes(app: FastifyInstance) {
  app.get("/categories", async (_request, reply) => {
    const categories = await getListingCategories();
    return reply.status(200).send({ categories });
  });

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

    return reply.status(200).send({
      items: listings.listings,
      listings: listings.listings,
      meta: listings.meta,
    });
  });

  app.get("/listings/me", { preHandler: requireAuth }, async (request, reply) => {
    const result = listListingsQuerySchema.safeParse(request.query);

    if (!result.success) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Please check the submitted query parameters.",
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

    const listings = await getSellerListings(user.id, result.data);
    return reply.status(200).send(listings);
  });

  app.get("/inquiries/me", { preHandler: requireAuth }, async (request, reply) => {
    const result = listListingsQuerySchema.safeParse(request.query);

    if (!result.success) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Please check the submitted query parameters.",
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

    const inquiries = await getBuyerInquiries(user.id, result.data);
    return reply.status(200).send(inquiries);
  });

  app.get("/listings/:listingId", async (request, reply) => {
    const result = listingParamsSchema.safeParse(request.params);

    if (!result.success) {
      throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
    }

    const listing = await getPublicListing(result.data.listingId);
    return reply.status(200).send({ listing });
  });

  app.post(
    "/listings/:listingId/images",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
      }

      const user = request.user;
      if (!user) {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication is required.",
        );
      }

      const files: Array<{ mimetype: string; buffer: Buffer }> = [];

      for await (const part of request.parts()) {
        if (part.type !== "file") {
          throw new AppError(
            400,
            "BAD_REQUEST",
            "Only image files may be included in this request.",
          );
        }

        files.push({
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        });
      }

      const images = await addListingImages(params.data.listingId, user.id, files);
      return reply.status(201).send({ images });
    },
  );

  app.post(
    "/listings/:listingId/inquiries",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
      }

      const result = createListingInquirySchema.safeParse(request.body);
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

      const inquiry = await createListingInquiry(
        params.data.listingId,
        user.id,
        result.data.message,
      );
      return reply.status(201).send({ inquiry });
    },
  );

  app.get(
    "/listings/:listingId/inquiries",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
      }

      const user = request.user;
      if (!user) {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication is required.",
        );
      }

      const inquiries = await getListingInquiries(
        params.data.listingId,
        user.id,
      );
      return reply.status(200).send({ inquiries });
    },
  );

  app.patch(
    "/listings/:listingId/inquiries/:inquiryId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingInquiryParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "The listing or inquiry ID is invalid.",
        );
      }

      const result = updateInquiryStatusSchema.safeParse(request.body);
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

      const inquiry = await updateInquiryStatus(
        params.data.listingId,
        params.data.inquiryId,
        user.id,
        result.data.status,
      );

      return reply.status(200).send({ inquiry });
    },
  );

  app.patch(
    "/listings/:listingId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
      }

      const result = updateListingSchema.safeParse(request.body);
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

      const listing = await updateListing(
        params.data.listingId,
        user.id,
        result.data,
      );
      return reply.status(200).send({ listing });
    },
  );

  app.delete(
    "/listings/:listingId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
      }

      const user = request.user;
      if (!user) {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication is required.",
        );
      }

      const listing = await removeListing(params.data.listingId, user.id);
      return reply.status(200).send({ listing });
    },
  );

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
    "/listings/:listingId/reserve",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
      }

      const user = request.user;
      if (!user) {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication is required.",
        );
      }

      const listing = await reserveListing(params.data.listingId, user.id);
      return reply.status(200).send({ listing });
    },
  );

  app.post(
    "/listings/:listingId/sold",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
      }

      const user = request.user;
      if (!user) {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication is required.",
        );
      }

      const listing = await markListingSold(params.data.listingId, user.id);
      return reply.status(200).send({ listing });
    },
  );

  app.post(
    "/listings/:listingId/release-reservation",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = listingParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(422, "VALIDATION_ERROR", "The listing ID is invalid.");
      }

      const user = request.user;
      if (!user) {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication is required.",
        );
      }

      const listing = await releaseListingReservation(
        params.data.listingId,
        user.id,
      );
      return reply.status(200).send({ listing });
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