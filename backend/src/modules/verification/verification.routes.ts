import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { enforceAuthRateLimit } from "../auth/rateLimiter.js";
import { submitVerificationSchema, universityEmailTokenSchema, verificationIdParams, verificationReviewSchema } from "./verification.schemas.js";
import { getUserVerificationState, listPendingManualVerifications, reviewManualVerification, submitVerification, verifyUniversityEmailToken } from "./verification.service.js";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(422, "VALIDATION_ERROR", "Please check the submitted fields.");
  return result.data;
}

export async function registerVerificationRoutes(app: FastifyInstance): Promise<void> {
  const reviewers = requireRole(Role.MODERATOR, Role.ADMINISTRATOR);

  app.get("/verification/me", { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    return await getUserVerificationState(request.user.id);
  });

  app.post("/verification", { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    const input = parse(submitVerificationSchema, request.body);
    return await submitVerification(request.user.id, {
      ...input,
      displayName: input.displayName ?? undefined,
      email: input.email ?? undefined,
    });
  });

  app.post("/verification/verify-email", async (request, reply) => {
    enforceAuthRateLimit(`university-verify:${request.ip}`);
    const { token } = parse(universityEmailTokenSchema, request.body);
    await verifyUniversityEmailToken(token);
    return reply.status(204).send();
  });

  app.get("/moderation/verifications", { preHandler: [requireAuth, reviewers] }, async () => ({ verifications: await listPendingManualVerifications() }));
  app.post("/moderation/verifications/:id/review", { preHandler: [requireAuth, reviewers] }, async (request) => {
    const { id } = parse(verificationIdParams, request.params);
    const { status, reason } = parse(verificationReviewSchema, request.body);
    if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    return { verification: await reviewManualVerification(id, request.user.id, status, reason) };
  });
}
