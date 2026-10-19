import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "noreply@example.test";
process.env.APP_URL = "http://localhost:3000";
process.env.STUDENT_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");

const { env } = await import("../src/config/env.js");
const {
  decryptRegistrationNumber,
  encryptRegistrationNumber,
  normalizeRegistrationNumber,
  registrationNumberHash,
} = await import("../src/modules/verification/verification.utils.js");

test("registration encryption round-trips and rejects a different valid key", () => {
  const originalKey = env.STUDENT_DATA_ENCRYPTION_KEY;
  const correctKey = Buffer.alloc(32, 1).toString("base64");
  const differentKey = Buffer.alloc(32, 2).toString("base64");
  const input = " ab/123-xy ";
  const normalized = normalizeRegistrationNumber(input);

  try {
    env.STUDENT_DATA_ENCRYPTION_KEY = correctKey;
    const ciphertext = encryptRegistrationNumber(input);

    assert.notEqual(ciphertext, input);
    assert.equal(decryptRegistrationNumber(ciphertext), normalized);
    assert.equal(registrationNumberHash(input), registrationNumberHash(normalized));

    env.STUDENT_DATA_ENCRYPTION_KEY = differentKey;
    assert.throws(() => decryptRegistrationNumber(ciphertext));
  } finally {
    env.STUDENT_DATA_ENCRYPTION_KEY = originalKey;
  }
});
