import type { FastifyRequest } from "fastify";
import { AppError } from "../app/errors.js";
import { env } from "../config/env.js";
import { getSessionUser } from "../modules/auth/auth.service.js";
import { hashToken } from "../modules/auth/auth.utils.js";
import "../modules/auth/auth.types.js";
import type { Role } from "@prisma/client";

export async function requireAuth(request: FastifyRequest): Promise<void> {
  const sessionToken = request.cookies[env.SESSION_COOKIE_NAME];
  if (!sessionToken) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
  const user = await getSessionUser(hashToken(sessionToken));
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
  request.user = user;
  request.sessionId = sessionToken;
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest): Promise<void> => {
    const user = request.user;
    if (!user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    if (!roles.includes(user.role)) throw new AppError(403, "FORBIDDEN", "You do not have permission to perform this action.");
  };
}
