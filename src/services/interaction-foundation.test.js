import assert from "node:assert/strict";
import test from "node:test";
import { classifyApiError } from "./apiErrors.js";
import { runWithLoading } from "./asyncOperation.js";

test("API error classification maps stable authentication and validation errors safely", () => {
  const credentials = classifyApiError({ response: { status: 401, data: { error: { code: "INVALID_CREDENTIALS" } } } }, "login");
  assert.equal(credentials.kind, "authentication");
  assert.equal(credentials.actionTo, "/forgot-password");

  const validation = classifyApiError({ response: { status: 422, data: { error: { code: "VALIDATION_ERROR", message: "internal raw text" } } } });
  assert.equal(validation.kind, "validation");
  assert.match(validation.message, /check the form fields/i);
  assert.doesNotMatch(validation.message, /internal raw text/);
});

test("registration conflicts provide a safe login recovery action", () => {
  const conflict = classifyApiError(
    { response: { status: 409, data: { error: { code: "REGISTRATION_CONFLICT" } } } },
    "register",
  );

  assert.equal(conflict.kind, "request");
  assert.equal(conflict.actionTo, "/login");
  assert.match(conflict.message, /already linked to an account/i);
});

test("API error classification distinguishes network, timeout, rate limit, upload, unavailable, and server errors", () => {
  assert.equal(classifyApiError({ isAxiosError: true, code: "ERR_NETWORK" }).kind, "network");
  assert.equal(classifyApiError({ isAxiosError: true, code: "ECONNABORTED" }).kind, "timeout");
  assert.equal(classifyApiError({ response: { status: 429, data: { error: { code: "AUTH_RATE_LIMITED" } } } }).kind, "rate-limit");
  assert.equal(classifyApiError({ response: { status: 413, data: { error: { code: "PAYLOAD_TOO_LARGE" } } } }).kind, "upload");
  assert.equal(classifyApiError({ response: { status: 422, data: { error: { code: "INVALID_IMAGE_TYPE" } } } }).kind, "upload");
  assert.equal(classifyApiError({ response: { status: 503, data: { error: { message: "DB detail" } } } }).kind, "unavailable");

  const server = classifyApiError({ response: { status: 500, data: { error: { message: "SQL connection string" } } } });
  assert.equal(server.kind, "server");
  assert.doesNotMatch(server.message, /SQL connection string/);
});

test("runWithLoading always clears loading state after success and failure", async () => {
  const transitions = [];
  const value = await runWithLoading(async () => "done", (loading) => transitions.push(loading));
  assert.equal(value, "done");
  assert.deepEqual(transitions, [true, false]);

  const failureTransitions = [];
  const failure = new Error("expected failure");
  await assert.rejects(
    runWithLoading(async () => { throw failure; }, (loading) => failureTransitions.push(loading)),
    (error) => error === failure,
  );
  assert.deepEqual(failureTransitions, [true, false]);
});
