import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../app/errors.js";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { profileUpdateSchema } from "./profile.schemas.js";
import { getCurrentProfile, getPublicSellerProfile, updateCurrentProfile } from "./profile.service.js";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(422, "VALIDATION_ERROR", "Please check the submitted profile fields.");
  return result.data;
}

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sellers/:sellerId", { preHandler: optionalAuth }, async (request, reply) => {
    const params = z.object({ sellerId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) throw new AppError(422, "VALIDATION_ERROR", "The seller ID is invalid.");
    const profile = await getPublicSellerProfile(params.data.sellerId, Boolean(request.user));
    return reply.status(200).send({ profile });
  });

  app.get("/profile", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    const profile = await getCurrentProfile(request.user.id);
    return reply.status(200).send({ profile });
  });

  app.patch("/profile", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    const input = parse(profileUpdateSchema, request.body);
    const profile = await updateCurrentProfile(request.user.id, input);
    return reply.status(200).send({ profile });
  });
}
