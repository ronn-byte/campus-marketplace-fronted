import type { Role, AccountStatus, User } from "@prisma/client";

type SafeUser = Pick<User, "id" | "email" | "role" | "accountStatus" | "emailVerifiedAt" | "createdAt">;

export type AuthenticatedUser = SafeUser & { role: Role; accountStatus: AccountStatus };

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    sessionId?: string;
  }
}

export function toSafeUser(user: SafeUser): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    accountStatus: user.accountStatus,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}
