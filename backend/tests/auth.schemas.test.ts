import assert from "node:assert/strict";
import test from "node:test";
import { loginSchema, registerSchema } from "../src/modules/auth/auth.schemas.js";

test("registration accepts ordinary email and full name with strict password rules", () => {
  const valid = registerSchema.parse({
    email: " Student@Example.com ",
    password: "a-secure-test-password",
    displayName: "Test User",
  });
  assert.equal(valid.email, "student@example.com");
  assert.equal(valid.displayName, "Test User");
  assert.equal(registerSchema.safeParse({ ...valid, password: "too-short" }).success, false);
  assert.equal(registerSchema.safeParse({ ...valid, confirmPassword: valid.password }).success, false);
  assert.equal(registerSchema.safeParse({ ...valid, verificationMethod: "UNIVERSITY_EMAIL" }).success, false);
});

test("registration preserves the 80-character display name limit", () => {
  const base = {
    email: "user@example.com",
    password: "a-secure-test-password",
  };

  for (const length of [60, 61, 80]) {
    assert.equal(
      registerSchema.safeParse({ ...base, displayName: "a".repeat(length) }).success,
      true,
      `${length}-character display name should be accepted`,
    );
  }

  assert.equal(
    registerSchema.safeParse({ ...base, displayName: "a".repeat(81) }).success,
    false,
    "81-character display name should be rejected",
  );
});

test("login accepts the current frontend identifier field without changing the API identity", () => {
  const result = loginSchema.parse({ identifier: " Student@Example.com ", password: "a-secure-test-password" });
  assert.equal(result.identifier, "student@example.com");
});
