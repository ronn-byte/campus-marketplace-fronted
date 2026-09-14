import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (envIsDevelopment()) {
  globalForPrisma.prisma = prisma;
}

function envIsDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}
