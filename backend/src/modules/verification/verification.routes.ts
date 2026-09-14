import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { verificationIdParams, verificationReviewSchema } from "./verification.schemas.js";
import { listPendingManualVerifications, reviewManualVerification } from "./verification.service.js";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(422, "VALIDATION_ERROR", "Please check the submitted fields.");
  return result.data;
}

export async function registerVerificationRoutes(app: FastifyInstance): Promise<void> {
  const reviewers = requireRole(Role.MODERATOR, Role.ADMINISTRATOR);
  app.get("/moderation/verifications", { preHandler: [requireAuth, reviewers] }, async () => ({ verifications: await listPendingManualVerifications() }));
  app.post("/moderation/verifications/:id/review", { preHandler: [requireAuth, reviewers] }, async (request) => {
    const { id } = parse(verificationIdParams, request.params);
    const { status, reason } = parse(verificationReviewSchema, request.body);
    if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    return { verification: await reviewManualVerification(id, request.user.id, status, reason) };
  });
}
