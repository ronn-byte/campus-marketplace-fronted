import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, hashToken, verifyPassword } from "../src/modules/auth/auth.utils.js";

test("password hashes verify without exposing the password", async () => {
  const password = "a-secure-test-password";
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, "wrong-password"), false);
});

test("session tokens are represented by one-way hashes", () => {
  const token = "opaque-session-token";
  const hash = hashToken(token);

  assert.notEqual(hash, token);
  assert.equal(hash, hashToken(token));
  assert.equal(hash.length, 64);
});
