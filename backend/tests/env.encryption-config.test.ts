import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envModuleUrl = pathToFileURL(
  resolve(backendRoot, "src/config/env.ts"),
).href;

function checkProductionEnvironment(key?: string) {
  const childEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://127.0.0.1:5432/test",
    CORS_ORIGIN: "http://localhost:5173",
    RESEND_API_KEY: "test-key",
    EMAIL_FROM: "noreply@example.test",
    APP_URL: "http://localhost:3000",
    DOTENV_CONFIG_PATH: resolve(
      tmpdir(),
      `mut-market-missing-env-${randomUUID()}`,
    ),
  };

  if (key === undefined) {
    delete childEnv.STUDENT_DATA_ENCRYPTION_KEY;
  } else {
    childEnv.STUDENT_DATA_ENCRYPTION_KEY = key;
  }

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", `import(${JSON.stringify(envModuleUrl)})`],
    {
      cwd: backendRoot,
      env: childEnv,
      encoding: "utf8",
      timeout: 15_000,
    },
  );
}

test("production environment rejects a missing student encryption key", () => {
  const result = checkProductionEnvironment();
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /STUDENT_DATA_ENCRYPTION_KEY/);
  assert.match(output, /required in production/);
});

test("production environment rejects non-Base64 student encryption keys", () => {
  const invalidKey = "not-base64!";
  const result = checkProductionEnvironment(invalidKey);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /STUDENT_DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(output, new RegExp(invalidKey));
});

test("production environment rejects keys that do not decode to 32 bytes", () => {
  const shortKey = Buffer.alloc(16, 7).toString("base64");
  const result = checkProductionEnvironment(shortKey);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /must decode to exactly 32 bytes/);
  assert.doesNotMatch(output, new RegExp(shortKey));
});

test("non-production environment may omit the student encryption key", () => {
  const childEnv = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://127.0.0.1:5432/test",
    CORS_ORIGIN: "http://localhost:5173",
    RESEND_API_KEY: "test-key",
    EMAIL_FROM: "noreply@example.test",
    APP_URL: "http://localhost:3000",
    DOTENV_CONFIG_PATH: resolve(
      tmpdir(),
      `mut-market-missing-env-${randomUUID()}`,
    ),
  };
  delete childEnv.STUDENT_DATA_ENCRYPTION_KEY;

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", `import(${JSON.stringify(envModuleUrl)})`],
    {
      cwd: backendRoot,
      env: childEnv,
      encoding: "utf8",
      timeout: 15_000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
});
