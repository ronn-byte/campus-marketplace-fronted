import type { FastifyInstance } from "fastify";
import { AppError } from "../../app/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import { createListingSchema } from "./listing.schemas.js";
import { createListing } from "./listing.service.js";

export async function registerListingRoutes(app: FastifyInstance) {
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
