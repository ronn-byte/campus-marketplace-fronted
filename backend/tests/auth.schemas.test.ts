import assert from "node:assert/strict";
import test from "node:test";
import { loginSchema, registerSchema } from "../src/modules/auth/auth.schemas.js";

test("authentication schemas normalize email and accept optional student verification data", () => {
  const result = registerSchema.safeParse({ 
    email: " Student@Example.com ", 
    password: "short",
    displayName: "Test User",
    verificationMethod: "MANUAL_STUDENT",
  });
  assert.equal(result.success, false);

  const valid = registerSchema.parse({ 
    email: " Student@Example.com ", 
    password: "a-secure-test-password",
    displayName: "Test User",
    verificationMethod: "MANUAL_STUDENT",
    registrationNumber: "ABC123",
  });
  assert.equal(valid.email, "student@example.com");
  assert.equal(valid.verificationMethod, "MANUAL_STUDENT");
  assert.equal(valid.registrationNumber, "ABC123");
});

test("login accepts the current frontend identifier field without changing the API identity", () => {
  const result = loginSchema.parse({ identifier: " Student@Example.com ", password: "a-secure-test-password" });
  assert.equal(result.identifier, "student@example.com");
});
