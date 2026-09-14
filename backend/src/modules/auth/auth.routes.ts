import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../app/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import { enforceAuthRateLimit } from "./rateLimiter.js";
import { createOpaqueToken, hashToken } from "./auth.utils.js";
import { forgotPasswordSchema, changePasswordSchema, loginSchema, registerSchema, resetPasswordSchema, tokenSchema } from "./auth.schemas.js";
import { authenticate, changePassword, createSession, register, requestPasswordReset, resendVerification, resetPassword, revokeSession, verifyEmail } from "./auth.service.js";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(422, "VALIDATION_ERROR", "Please check the submitted fields.");
  return result.data;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    enforceAuthRateLimit(`register:${request.ip}`);
    const input = parse(registerSchema, request.body);
    const user = await register(input);
    return reply.status(201).send({ user });
  });

  app.post("/auth/login", async (request, reply) => {
    enforceAuthRateLimit(`login:${request.ip}`);
    const input = parse(loginSchema, request.body);
    const { user, userId } = await authenticate(input);
    const rawSession = createOpaqueToken();
    const userAgent = request.headers["user-agent"];
    await createSession(userId, hashToken(rawSession), { ipAddress: request.ip, ...(typeof userAgent === "string" ? { userAgent } : {}) });
    reply.setCookie(env.SESSION_COOKIE_NAME, rawSession, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: env.SESSION_TTL_HOURS * 60 * 60,
    });
    return reply.status(200).send({ user });
  });

  app.post("/auth/logout", async (request, reply) => {
    const rawSession = request.cookies[env.SESSION_COOKIE_NAME];
    if (rawSession) await revokeSession(hashToken(rawSession));
    reply.clearCookie(env.SESSION_COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" });
    return reply.status(204).send();
  });

  const meHandler = async (request: FastifyRequest) => ({ user: request.user });
  app.get("/auth/me", { preHandler: requireAuth }, meHandler);
  app.get("/auth/session", { preHandler: requireAuth }, meHandler);

  app.post("/auth/verify-email", async (request, reply) => {
    enforceAuthRateLimit(`verify:${request.ip}`);
    const { token } = parse(tokenSchema, request.body);
    await verifyEmail(token);
    return reply.status(204).send();
  });

  app.post("/auth/resend-verification", async (request, reply) => {
    enforceAuthRateLimit(`resend:${request.ip}`);
    const { email } = parse(forgotPasswordSchema, request.body);
    await resendVerification(email);
    return reply.status(202).send({ message: "If the account is eligible, verification instructions will be sent shortly." });
  });

  app.post("/auth/forgot-password", async (request, reply) => {
    enforceAuthRateLimit(`forgot:${request.ip}`);
    const { email } = parse(forgotPasswordSchema, request.body);
    await requestPasswordReset(email);
    return reply.status(202).send({ message: "If the account exists, password reset instructions will be sent shortly." });
  });

  app.post("/auth/reset-password", async (request, reply) => {
    enforceAuthRateLimit(`reset:${request.ip}`);
    const input = parse(resetPasswordSchema, request.body);
    await resetPassword(input);
    return reply.status(204).send();
  });

  app.post("/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
    enforceAuthRateLimit(`change:${request.ip}`);
    const input = parse(changePasswordSchema, request.body);
    if (!request.user || !request.sessionId) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    await changePassword(request.user.id, input.currentPassword, input.newPassword);
    reply.clearCookie(env.SESSION_COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" });
    return reply.status(204).send();
  });
}
