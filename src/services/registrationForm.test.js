import assert from "node:assert/strict";
import test from "node:test";
import { passwordsMatch, registrationPayload } from "./registrationForm.js";

test("registration password confirmation requires an exact match", () => {
  assert.equal(passwordsMatch("a-secure-password", "a-secure-password"), true);
  assert.equal(passwordsMatch("a-secure-password", "a-secure-password "), false);
  assert.equal(passwordsMatch("a-secure-password", ""), false);
});

test("registration payload excludes confirmPassword", () => {
  const payload = registrationPayload({
    displayName: "Test User",
    email: "user@example.com",
    password: "a-secure-password",
    confirmPassword: "a-secure-password",
  });
  assert.deepEqual(payload, {
    displayName: "Test User",
    email: "user@example.com",
    password: "a-secure-password",
  });
});
