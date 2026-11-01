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
    EMAIL_PROVIDER: "resend",
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

function checkEmailEnvironment(
  overrides: Record<string, string | undefined>,
  inspectLoadedConfig = false,
) {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://127.0.0.1:5432/test",
    CORS_ORIGIN: "http://localhost:5173",
    EMAIL_FROM: "noreply@example.test",
    APP_URL: "http://localhost:3000",
    DOTENV_CONFIG_PATH: resolve(
      tmpdir(),
      `mut-market-email-env-${randomUUID()}`,
    ),
  };

  for (const key of [
    "EMAIL_PROVIDER",
    "RESEND_API_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
  ]) {
    delete childEnv[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }

  const expression = inspectLoadedConfig
    ? `import(${JSON.stringify(envModuleUrl)}).then(({ env }) => process.stdout.write(JSON.stringify({ provider: env.EMAIL_PROVIDER, secure: env.SMTP_SECURE === "true" })))`
    : `import(${JSON.stringify(envModuleUrl)})`;

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", expression],
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
    EMAIL_PROVIDER: "resend",
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

test("SMTP provider validates its own settings without requiring Resend credentials", () => {
  const missingPassword = checkEmailEnvironment({
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "noreply@example.test",
  });
  const failure = `${missingPassword.stdout ?? ""}${missingPassword.stderr ?? ""}`;

  assert.notEqual(missingPassword.status, 0);
  assert.match(failure, /SMTP_PASS/);
  assert.doesNotMatch(failure, /replace-with|password|secret/i);

  const validSmtp = checkEmailEnvironment({
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "noreply@example.test",
    SMTP_PASS: "test-app-password",
  });

  assert.equal(validSmtp.status, 0, validSmtp.stderr);
});

test("SMTP_SECURE parses the literal false value as false", () => {
  const result = checkEmailEnvironment({
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "noreply@example.test",
    SMTP_PASS: "test-app-password",
  }, true);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, JSON.stringify({ provider: "smtp", secure: false }));
});

test("SMTP provider rejects invalid ports, secure values, and sender identities", () => {
  const invalidConfigs: Array<[Record<string, string>, RegExp]> = [
    [
      {
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "65536",
        SMTP_SECURE: "true",
        SMTP_USER: "noreply@example.test",
        SMTP_PASS: "test-app-password",
      },
      /SMTP_PORT/,
    ],
    [
      {
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "yes",
        SMTP_USER: "noreply@example.test",
        SMTP_PASS: "test-app-password",
      },
      /SMTP_SECURE/,
    ],
    [
      {
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "authenticated@example.test",
        SMTP_PASS: "test-app-password",
      },
      /EMAIL_FROM/,
    ],
  ];

  for (const [configuration, expectedField] of invalidConfigs) {
    const result = checkEmailEnvironment(configuration);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    assert.notEqual(result.status, 0);
    assert.match(output, expectedField);
    assert.doesNotMatch(output, /test-app-password/);
  }
});

test("Resend remains the default and SMTP credentials are not required in Resend mode", () => {
  const result = checkEmailEnvironment({ RESEND_API_KEY: "test-key" }, true);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, JSON.stringify({ provider: "resend", secure: false }));
});

test("invalid email provider is rejected", () => {
  const result = checkEmailEnvironment({
    EMAIL_PROVIDER: "other",
    RESEND_API_KEY: "test-key",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /EMAIL_PROVIDER/);
});
