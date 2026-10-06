import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerListingRoutes } from "../modules/listings/listing.routes.js";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { env } from "../config/env.js";
import { AppError, errorPayload, getErrorMessage, isHttpError } from "./errors.js";
import { registerAuthRoutes } from "../modules/auth/auth.routes.js";
import { registerProfileRoutes } from "../modules/profile/profile.routes.js";
import { registerVerificationRoutes } from "../modules/verification/verification.routes.js";
import {
  MAX_LISTING_IMAGE_BYTES,
  MAX_LISTING_IMAGES_PER_LISTING,
} from "../lib/storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backendRootPath = path.resolve(__dirname, "../..");
const frontendDistPath = path.resolve(backendRootPath, "../dist");
const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_ROOT);
fs.mkdirSync(uploadRoot, { recursive: true });

export function buildApp(): FastifyInstance {
  const hasFrontendBuild = fs.existsSync(path.join(frontendDistPath, "index.html"));
  if (env.NODE_ENV === "production" && !hasFrontendBuild) {
    throw new Error(`Frontend build not found at ${frontendDistPath}. Run the root production build first.`);
  }

  const app = Fastify({
    logger: env.NODE_ENV !== "test",
    bodyLimit: 10 * 1024 * 1024,
    requestIdHeader: "x-request-id",
  });

  if (hasFrontendBuild) {
    app.register(fastifyStatic, {
      root: frontendDistPath,
      prefix: "/",
    });
  }

  app.register(fastifyStatic, {
    root: uploadRoot,
    prefix: "/uploads/",
    decorateReply: false,
  });

  app.register(helmet);
  app.register(cookie);
  app.register(multipart, {
    limits: {
      fileSize: MAX_LISTING_IMAGE_BYTES,
      files: MAX_LISTING_IMAGES_PER_LISTING,
      fields: 0,
      parts: MAX_LISTING_IMAGES_PER_LISTING,
    },
  });
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

    if (isHttpError(error) && error.statusCode === 413) {
      return reply.status(413).send(errorPayload("PAYLOAD_TOO_LARGE", "The request exceeds the allowed upload size."));
    }

    request.log.error({ err: error }, "Unhandled request error");
    const message = env.NODE_ENV === "production" ? "Something went wrong." : getErrorMessage(error);
    return reply.status(500).send(errorPayload("INTERNAL_ERROR", message));
  });

  app.register(async (api) => {
    api.get("/health", async () => ({ status: "ok" }));
    await registerAuthRoutes(api);
    await registerProfileRoutes(api);
    await registerListingRoutes(api);
    await registerVerificationRoutes(api);
  }, { prefix: "/api/v1" });

  app.setNotFoundHandler(async (request, reply) => {
    const requestPath = request.url.split("?")[0] ?? request.url;
    if (requestPath === "/api" || requestPath.startsWith("/api/")) {
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
        },
      });
    }

    if (!hasFrontendBuild) {
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
        },
      });
    }

    return reply.sendFile("index.html");
  });

  return app;
}
