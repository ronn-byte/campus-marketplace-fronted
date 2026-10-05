import "dotenv/config";

process.env.NODE_ENV = "test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl?.trim()) {
  throw new Error(
    "TEST_DATABASE_URL is required for backend tests. Set it to a dedicated test database; DATABASE_URL is never used as a fallback.",
  );
}

let parsedTestDatabaseUrl: URL;

try {
  parsedTestDatabaseUrl = new URL(testDatabaseUrl);
} catch {
  throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
}

if (parsedTestDatabaseUrl.protocol !== "postgresql:") {
  throw new Error("TEST_DATABASE_URL must use the postgresql:// protocol.");
}

const databaseName = decodeURIComponent(parsedTestDatabaseUrl.pathname.replace(/^\/+|\/+$/g, "")).toLowerCase();

if (databaseName === "campus_marketplace_dev") {
  throw new Error("TEST_DATABASE_URL must not target the campus_marketplace_dev database.");
}

process.env.DATABASE_URL = testDatabaseUrl;
