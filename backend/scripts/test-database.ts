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
const isApprovedAzureTestDatabase =
  parsedUrl.hostname.toLowerCase() === approvedHost
  && databaseName === approvedDatabase;
const isApprovedDisposableLocalDatabase =
  parsedUrl.hostname === "127.0.0.1"
  && parsedUrl.port === "55439"
  && parsedUrl.username === "ron"
  && parsedUrl.password === ""
  && databaseName === "mutmarket_legacy"
  && parsedUrl.search === "?schema=public"
  && parsedUrl.hash === "";

if (!isApprovedAzureTestDatabase && !isApprovedDisposableLocalDatabase) {
  throw new Error(
    `Tests blocked: TEST_DATABASE_URL must target ${approvedHost}/${approvedDatabase} or 127.0.0.1:55439/mutmarket_legacy; received ${parsedUrl.hostname}:${parsedUrl.port}/${databaseName}.`,
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
