import assert from "node:assert/strict";
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
  createEmailProviderSender,
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
      return { sendMail: async () => ({}) };
    };

    await import(${JSON.stringify(emailModuleUrl)});

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

  assert.equal(result.status, 0, "Isolated SMTP transport configuration check failed.");
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
  });
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
