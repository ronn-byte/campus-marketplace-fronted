import "dotenv/config";

process.env.NODE_ENV = "test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl?.trim()) {
  throw new Error(
    "TEST_DATABASE_URL is required. Backend tests must use the dedicated test database.",
  );
}

let parsedUrl: URL;

try {
  parsedUrl = new URL(testDatabaseUrl);
} catch {
  throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
}

if (parsedUrl.protocol !== "postgresql:") {
  throw new Error("TEST_DATABASE_URL must use the postgresql:// protocol.");
}

const databaseName = decodeURIComponent(
  parsedUrl.pathname.replace(/^\/+|\/+$/g, ""),
).toLowerCase();

const approvedHost =
  "campus-marketplace-db.postgres.database.azure.com";
const approvedDatabase = "campus_marketplace_test";

if (parsedUrl.hostname.toLowerCase() !== approvedHost) {
  throw new Error(
    "Tests blocked: TEST_DATABASE_URL host is not the approved test server.",
  );
}

if (databaseName !== approvedDatabase) {
  throw new Error(
    `Tests blocked: expected database "${approvedDatabase}", received "${databaseName}".`,
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
