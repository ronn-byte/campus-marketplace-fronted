import { registerListingRoutes } from "../modules/listings/listing.routes.js";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import { env } from "../config/env.js";
import { AppError, errorPayload, getErrorMessage, isHttpError } from "./errors.js";
import { registerAuthRoutes } from "../modules/auth/auth.routes.js";
import { registerVerificationRoutes } from "../modules/verification/verification.routes.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV !== "test",
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id",
  });

  app.register(helmet);
  app.register(cookie);
  app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(errorPayload(error.code, error.message));
    }

    if (isHttpError(error) && error.statusCode === 400) {
      return reply.status(400).send(errorPayload("BAD_REQUEST", "The request could not be understood."));
    }

    request.log.error({ err: error }, "Unhandled request error");
    const message = env.NODE_ENV === "production" ? "Something went wrong." : getErrorMessage(error);
    return reply.status(500).send(errorPayload("INTERNAL_ERROR", message));
  });

  app.register(async (api) => {
    api.get("/health", async () => ({ status: "ok" }));
    await registerAuthRoutes(api);
    await registerListingRoutes(api);
    await registerVerificationRoutes(api);
  }, { prefix: "/api/v1" });

  return app;
}
