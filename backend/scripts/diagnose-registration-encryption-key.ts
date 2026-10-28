import dotenv from "dotenv";
import { resolve } from "node:path";

let disconnect: (() => Promise<void>) | undefined;
let result:
  | { checked: number; matched: number; failed: number }
  | undefined;
let diagnosticFailed = false;

try {
  const loaded = dotenv.config({
    path: resolve(process.cwd(), ".env"),
    override: true,
  });

  if (loaded.error) {
    throw new Error("Configuration unavailable");
  }

  const databaseUrl = process.env.DATABASE_URL;
  const candidateKey = process.env.STUDENT_DATA_ENCRYPTION_KEY;
  if (!databaseUrl || !candidateKey?.trim()) {
    throw new Error("Required configuration unavailable");
  }

  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(
    target.pathname.replace(/^\/+|\/+$/g, ""),
  );

  if (
    target.protocol !== "postgresql:" ||
    target.hostname !== "campus-marketplace-db.postgres.database.azure.com" ||
    (target.port !== "" && target.port !== "5432") ||
    databaseName !== "campus_marketplace_dev"
  ) {
    throw new Error("Database target rejected");
  }

  const { prisma } = await import("../src/lib/prisma.js");
  disconnect = () => prisma.$disconnect();

  const {
    decryptRegistrationNumber,
    normalizeRegistrationNumber,
    registrationNumberHash,
  } = await import("../src/modules/verification/verification.utils.js");

  const records = await prisma.studentProfile.findMany({
    where: { registrationNumberCiphertext: { not: null } },
    select: {
      registrationNumberCiphertext: true,
      registrationNumberHash: true,
    },
  });

  let matched = 0;
  let failed = 0;

  for (const record of records) {
    try {
      if (!record.registrationNumberCiphertext || !record.registrationNumberHash) {
        failed++;
        continue;
      }

      const decrypted = decryptRegistrationNumber(
        record.registrationNumberCiphertext,
      );
      const normalized = normalizeRegistrationNumber(decrypted);
      const recomputedHash = registrationNumberHash(normalized);

      if (recomputedHash === record.registrationNumberHash) {
        matched++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  result = { checked: records.length, matched, failed };
} catch {
  diagnosticFailed = true;
} finally {
  if (disconnect) {
    try {
      await disconnect();
    } catch {
      diagnosticFailed = true;
    }
  }
}

if (diagnosticFailed || !result) {
  console.error("Diagnostic failed; no sensitive details emitted.");
  process.exitCode = 1;
} else {
  console.log(`RECORDS_CHECKED=${result.checked}`);
  console.log(`DECRYPTED_HASH_MATCH=${result.matched}`);
  console.log(`FAILED=${result.failed}`);
}
