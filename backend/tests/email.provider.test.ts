import assert from "node:assert/strict";
import { Socket } from "node:net";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "noreply@example.test";
process.env.APP_URL = "http://localhost:3000";

const {
  createEmailDiagnostic,
  createEmailProviderSender,
  createSmtpEmailSender,
  emailTransport,
  sendPasswordResetEmail,
  sendUniversityVerificationEmail,
  sendVerificationEmail,
} = await import("../src/lib/email.js");

test("all email functions preserve sender, recipient, subject, and encoded links", async () => {
  const messages: Array<{
    from: string;
    to: string;
    subject: string;
    html: string;
  }> = [];
  const originalSend = emailTransport.send;
  emailTransport.send = async (message) => {
    messages.push(message);
  };

  try {
    await sendVerificationEmail("buyer@example.test", "account+/?&token");
    await sendUniversityVerificationEmail("student@example.test", "student+/?&token");
    await sendPasswordResetEmail("reset@example.test", "reset+/?&token");
  } finally {
    emailTransport.send = originalSend;
  }

  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map(({ from, to, subject }) => ({ from, to, subject })), [
    {
      from: "noreply@example.test",
      to: "buyer@example.test",
      subject: "Verify your Campus Market account",
    },
    {
      from: "noreply@example.test",
      to: "student@example.test",
      subject: "Verify your MUT student email",
    },
    {
      from: "noreply@example.test",
      to: "reset@example.test",
      subject: "Reset your Campus Market password",
    },
  ]);
  assert.match(messages[0]!.html, /http:\/\/localhost:3000\/verify-email\?token=account%2B%2F%3F%26token/);
  assert.match(messages[0]!.html, /expire in 48 hours/);
  assert.match(messages[1]!.html, /http:\/\/localhost:3000\/verify-university-email\?token=student%2B%2F%3F%26token/);
  assert.match(messages[1]!.html, /expire in 48 hours/);
  assert.match(messages[2]!.html, /http:\/\/localhost:3000\/reset-password\?token=reset%2B%2F%3F%26token/);
  assert.match(messages[2]!.html, /expire in 30 minutes/);
});

test("SMTP and Resend provider selections call only their configured boundary", async () => {
  const message = {
    from: "noreply@example.test",
    to: "recipient@example.test",
    subject: "Test message",
    html: "<p>Test</p>",
  };
  const smtpMessages: typeof message[] = [];
  const resendMessages: typeof message[] = [];

  const smtpSender = createEmailProviderSender("smtp", {
    smtp: {
      sendMail: async (outgoing) => {
        smtpMessages.push(outgoing);
        return {};
      },
    },
  });
  const resendSender = createEmailProviderSender("resend", {
    resend: {
      emails: {
        send: async (outgoing) => {
          resendMessages.push(outgoing);
          return { error: null };
        },
      },
    },
  });

  await smtpSender(message);
  await resendSender(message);

  assert.deepEqual(smtpMessages, [message]);
  assert.deepEqual(resendMessages, [message]);
});

test("SMTP provider configures Nodemailer with bounded timeouts and validated TLS", () => {
  const emailModuleUrl = new URL("../src/lib/email.ts", import.meta.url).href;
  const script = `
    import nodemailer from "nodemailer";

    const transports = [];
    nodemailer.createTransport = (options) => {
      transports.push(options);
      return { sendMail: async () => ({}), close: () => {} };
    };
    console.log = () => {};
    console.error = () => {};

    const email = await import(${JSON.stringify(emailModuleUrl)});
    await email.sendVerificationEmail("recipient@example.test", "test-token");

    const options = transports[0] ?? {};
    const checks = {
      createdExactlyOneTransport: transports.length === 1,
      host: options.host === "smtp.gmail.com",
      port: options.port === 587,
      secure: options.secure === false,
      requireTls: options.requireTLS === true,
      username: options.auth?.user === process.env.SMTP_USER,
      password: options.auth?.pass === process.env.SMTP_PASS,
      connectionTimeout: options.connectionTimeout === 10000,
      greetingTimeout: options.greetingTimeout === 10000,
      socketTimeout: options.socketTimeout === 20000,
      certificateValidation: options.tls?.rejectUnauthorized === true,
      customSocketProvider: typeof options.getSocket === "function",
    };

    process.stdout.write(JSON.stringify(checks));
  `;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://127.0.0.1:5432/test",
    CORS_ORIGIN: "http://localhost:5173",
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "smtp-user@example.test",
    SMTP_PASS: "test-only-smtp-password",
    EMAIL_FROM: "smtp-user@example.test",
    APP_URL: "http://localhost:3000",
  };
  delete childEnv.RESEND_API_KEY;

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: childEnv,
      encoding: "utf8",
      timeout: 15_000,
    },
  );

    assert.equal(
      result.status,
      0,
      `Isolated SMTP transport configuration check failed: ${result.stderr}`,
    );
    const checks = JSON.parse(result.stdout) as Record<string, boolean>;
    assert.deepEqual(checks, {
    createdExactlyOneTransport: true,
    host: true,
    port: true,
    secure: true,
    requireTls: true,
    username: true,
    password: true,
    connectionTimeout: true,
    greetingTimeout: true,
    socketTimeout: true,
    certificateValidation: true,
    customSocketProvider: true,
  });
});

test("SMTP authentication and connection timeout failures are classified safely", () => {
  assert.deepEqual(
    createEmailDiagnostic(
      "smtp",
      Object.assign(new Error("untrusted detail"), {
        code: "EAUTH",
        command: "AUTH XOAUTH2",
        responseCode: 535,
      }),
    ),
    {
      provider: "smtp",
      category: "authentication",
      code: "EAUTH",
      command: "AUTH",
      responseCode: 535,
    },
  );
  assert.deepEqual(
    createEmailDiagnostic(
      "smtp",
      Object.assign(new Error("untrusted detail"), {
        code: "ETIMEDOUT",
        command: "CONN",
      }),
    ),
    {
      provider: "smtp",
      category: "connection_timeout",
      code: "ETIMEDOUT",
      command: "CONN",
    },
  );
});

test("email diagnostics omit credentials, recipients, tokens, and message content", () => {
  const diagnostic = createEmailDiagnostic(
    "smtp",
    Object.assign(
      new Error("SMTP_PASS=private-password token=private-token"),
      {
        code: "EAUTH",
        command: "AUTH private-recipient@example.test private-token",
        responseCode: 535,
        response: "private-message-content private-password",
        recipient: "private-recipient@example.test",
      },
    ),
  );
  const serialized = JSON.stringify(diagnostic);

  assert.deepEqual(diagnostic, {
    provider: "smtp",
    category: "authentication",
    code: "EAUTH",
    command: "AUTH",
    responseCode: 535,
  });
  for (const sensitiveValue of [
    "private-password",
    "private-token",
    "private-recipient@example.test",
    "private-message-content",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(sensitiveValue));
  }
});

test("SMTP delivery deadline destroys the active socket and closes its transport", async () => {
  let connectorSocket: Socket | undefined;
  let getSocketCalled = false;
  let closeCount = 0;
  const sender = createSmtpEmailSender(
    { host: "smtp.example.test", port: 465, secure: true },
    (options) => ({
      sendMail: () =>
        new Promise((_resolve, reject) => {
          getSocketCalled = true;
          options.getSocket?.(options, (error, socketOptions) => {
            if (error) {
              reject(error);
              return;
            }
            const activeSocket = socketOptions?.connection as Socket | undefined;
            activeSocket?.once("close", () => reject(new Error("socket closed")));
          });
        }),
      close: () => {
        closeCount += 1;
      },
    }),
    (_options, callback) => {
      const socket = new Socket();
      connectorSocket = socket;
      setImmediate(() => callback(null, socket));
      return socket;
    },
    25,
  );

  await assert.rejects(
    () => sender({
      from: "sender@example.test",
      to: "recipient@example.test",
      subject: "Test",
      html: "<p>Test</p>",
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "EMAIL_DELIVERY_TIMEOUT");
      return true;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getSocketCalled, true);
  assert.ok(connectorSocket?.destroyed);
  assert.equal(closeCount, 1);
});

async function assertSmtpPhaseTimesOut(
  phase: "connection" | "authentication" | "message transmission",
): Promise<void> {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledTimers: NodeJS.Timeout[] = [];
  const clearedTimers = new Set<NodeJS.Timeout>();
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  const trackedSetTimeout: typeof globalThis.setTimeout = (...args) => {
    const timer = originalSetTimeout(...args);
    scheduledTimers.push(timer);
    return timer;
  };
  const trackedClearTimeout: typeof globalThis.clearTimeout = (timer) => {
    if (timer && typeof timer === "object") clearedTimers.add(timer);
    originalClearTimeout(timer);
  };

  let connectorSocket: Socket | undefined;
  let activeSocket: Socket | undefined;
  let observedPhase = "";
  let closeCount = 0;
  const sender = createSmtpEmailSender(
    { host: "smtp.example.test", port: 465, secure: true },
    (options) => ({
      sendMail: () =>
        new Promise((_resolve, reject) => {
          options.getSocket?.(options, (error, socketOptions) => {
            if (error) {
              reject(error);
              return;
            }

            activeSocket = socketOptions?.connection as Socket | undefined;
            if (phase === "connection") {
              reject(new Error("Unexpected connection completion."));
              return;
            }

            observedPhase =
              phase === "authentication" ? "AUTH" : "DATA";
            activeSocket?.once("close", () => {
              reject(new Error("SMTP socket closed during delivery."));
            });
          });
        }),
      close: () => {
        closeCount += 1;
      },
    }),
    (_options, callback) => {
      const socket = new Socket();
      connectorSocket = socket;
      if (phase !== "connection") {
        callback(null, socket);
      }
      return socket;
    },
    20,
  );

  globalThis.setTimeout = trackedSetTimeout;
  globalThis.clearTimeout = trackedClearTimeout;
  process.on("unhandledRejection", onUnhandledRejection);

  try {
    await assert.rejects(
      () => sender({
        from: "sender@example.test",
        to: "recipient@example.test",
        subject: "Test",
        html: "<p>Test</p>",
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "EMAIL_DELIVERY_TIMEOUT",
        );
        return true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.ok(connectorSocket?.destroyed, "the connected or pending socket is destroyed");
    if (phase !== "connection") {
      assert.equal(observedPhase, phase === "authentication" ? "AUTH" : "DATA");
      assert.equal(activeSocket, connectorSocket);
    }
    assert.equal(closeCount, 1);
    assert.equal(scheduledTimers.length, 1);
    assert.ok(
      clearedTimers.has(scheduledTimers[0]!),
      "the delivery deadline timer is cleared",
    );
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.removeListener("unhandledRejection", onUnhandledRejection);
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    connectorSocket?.destroy();
  }
}

test("SMTP deadline destroys a TCP socket whose connection remains pending", async () => {
  await assertSmtpPhaseTimesOut("connection");
});

test("SMTP deadline cleans up when authentication hangs", async () => {
  await assertSmtpPhaseTimesOut("authentication");
});

test("SMTP deadline cleans up when message transmission hangs", async () => {
  await assertSmtpPhaseTimesOut("message transmission");
});

test("Resend delivery deadline aborts its in-flight request", async () => {
  let requestSignal: AbortSignal | undefined;
  const sender = createEmailProviderSender(
    "resend",
    {
      resend: {
        emails: {
          send: async (_message, options) => {
            requestSignal = options?.signal;
            return new Promise((_resolve, reject) => {
              requestSignal?.addEventListener("abort", () => {
                reject(new Error("request aborted"));
              });
            });
          },
        },
      },
    },
    20,
  );

  await assert.rejects(() => sender({
    from: "sender@example.test",
    to: "recipient@example.test",
    subject: "Test",
    html: "<p>Test</p>",
  }));
  assert.equal(requestSignal?.aborted, true);
});

test("provider errors are replaced with a generic error without exposing details", async () => {
  const sensitiveProviderError = "smtp-password-and-token-must-not-leak";
  const send = createEmailProviderSender("resend", {
    resend: {
      emails: {
        send: async () => ({ error: sensitiveProviderError }),
      },
    },
  });

  await assert.rejects(
    () => send({
      from: "noreply@example.test",
      to: "recipient@example.test",
      subject: "Test message",
      html: "<p>Test</p>",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Resend email provider returned an error.");
      assert.doesNotMatch(error.message, /password|token/i);
      return true;
    },
  );
});

test("delivery errors for all email flows are generic and never log provider details", async () => {
  const sensitiveProviderError = "smtp-password-and-token-must-not-leak";
  const previousSend = emailTransport.send;
  const previousConsoleError = console.error;
  const loggedErrors: string[] = [];
  emailTransport.send = async () => {
    throw new Error(sensitiveProviderError);
  };
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args.map(String).join(" "));
  };

  try {
    const emailFlows: Array<[
      (email: string, token: string) => Promise<void>,
      string,
    ]> = [
      [sendVerificationEmail, "Verification email could not be sent."],
      [sendUniversityVerificationEmail, "University verification email could not be sent."],
      [sendPasswordResetEmail, "Password reset email could not be sent."],
    ];

    for (const [sendEmail, expectedMessage] of emailFlows) {
      await assert.rejects(
        () => sendEmail("recipient@example.test", "opaque-test-token"),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, expectedMessage);
          assert.doesNotMatch(error.message, /smtp-password-and-token-must-not-leak/);
          return true;
        },
      );
    }

    assert.doesNotMatch(loggedErrors.join(" "), /smtp-password|token-must-not-leak/);
  } finally {
    emailTransport.send = previousSend;
    console.error = previousConsoleError;
  }
});
