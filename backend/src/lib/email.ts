import { connect as connectSocket, type Socket } from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import type { SMTPTransportOptions } from "nodemailer/lib/smtp-transport";
import { Resend } from "resend";
import { env } from "../config/env.js";

export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

type ResendEmailClient = {
  emails: {
    send(
      _message: EmailMessage,
      _options?: { signal?: AbortSignal },
    ): Promise<{ error: unknown | null }>;
  };
};

type SmtpEmailClient = {
  sendMail(_message: EmailMessage): Promise<unknown>;
};
type SmtpSocketConnector = (
  _options: { host: string; port: number },
  _callback: (_error: Error | null, _socket?: Socket) => void,
) => Socket;
type SmtpTransportFactory = (
  _options: SMTPTransportOptions,
) => Pick<Transporter, "sendMail" | "close">;

const EMAIL_DELIVERY_DEADLINE_MS = 15_000;
const SMTP_ERROR_CODES = new Set([
  "EAUTH",
  "EAI_AGAIN",
  "ECONNECTION",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNUNAVAILABLE",
  "EDNS",
  "EENVELOPE",
  "EMAIL_DELIVERY_TIMEOUT",
  "EMESSAGE",
  "ENOTFOUND",
  "ERECEIVERS",
  "ESOCKET",
  "ETIMEDOUT",
  "ETLS",
]);
const SMTP_COMMANDS = [
  "AUTH",
  "CONN",
  "DATA",
  "EHLO",
  "HELO",
  "MAIL FROM",
  "QUIT",
  "RCPT TO",
  "STARTTLS",
] as const;

type EmailFailureCategory =
  | "authentication"
  | "connection"
  | "connection_timeout"
  | "delivery_timeout"
  | "smtp_rejected"
  | "provider_error";

type EmailDiagnostic = {
  provider: "smtp" | "resend";
  category: EmailFailureCategory;
  code?: string;
  command?: (typeof SMTP_COMMANDS)[number];
  responseCode?: number;
};

class EmailDeliveryTimeoutError extends Error {
  readonly code = "EMAIL_DELIVERY_TIMEOUT";

  constructor() {
    super("Email delivery exceeded its deadline.");
  }
}

function getErrorDetails(error: unknown): {
  code?: string;
  command?: (typeof SMTP_COMMANDS)[number];
  responseCode?: number;
} {
  if (typeof error !== "object" || error === null) return {};

  const details = error as {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
  };
  const code =
    typeof details.code === "string" && SMTP_ERROR_CODES.has(details.code)
      ? details.code
      : undefined;
  const rawCommand =
    typeof details.command === "string" ? details.command.toUpperCase() : "";
  const command = SMTP_COMMANDS.find((allowed) =>
    rawCommand === allowed || rawCommand.startsWith(`${allowed} `),
  );
  const responseCode =
    typeof details.responseCode === "number" &&
    Number.isInteger(details.responseCode) &&
    details.responseCode >= 100 &&
    details.responseCode <= 599
      ? details.responseCode
      : undefined;

  return {
    ...(code ? { code } : {}),
    ...(command ? { command } : {}),
    ...(responseCode ? { responseCode } : {}),
  };
}

export function createEmailDiagnostic(
  provider: "smtp" | "resend",
  error: unknown,
): EmailDiagnostic {
  const details = getErrorDetails(error);
  let category: EmailFailureCategory = "provider_error";

  if (details.code === "EMAIL_DELIVERY_TIMEOUT") {
    category = "delivery_timeout";
  } else if (
    details.code === "EAUTH" ||
    details.command === "AUTH" ||
    details.responseCode === 534 ||
    details.responseCode === 535
  ) {
    category = "authentication";
  } else if (details.code === "ETIMEDOUT") {
    category = "connection_timeout";
  } else if (
    details.code === "ECONNECTION" ||
    details.code === "ECONNRESET" ||
    details.code === "ECONNREFUSED" ||
    details.code === "ECONNUNAVAILABLE" ||
    details.code === "EDNS" ||
    details.code === "ENOTFOUND" ||
    details.code === "ESOCKET" ||
    details.code === "ETLS"
  ) {
    category = "connection";
  } else if (details.responseCode && details.responseCode >= 400) {
    category = "smtp_rejected";
  }

  return { provider, category, ...details };
}

function openSmtpSocket(
  options: { host: string; port: number },
  callback: (_error: Error | null, _socket?: Socket) => void,
): Socket {
  const socket = connectSocket(options);
  let settled = false;
  const onError = (error: Error) => {
    if (settled) return;
    settled = true;
    callback(error);
  };

  socket.once("error", onError);
  socket.once("connect", () => {
    if (settled) return;
    settled = true;
    socket.removeListener("error", onError);
    callback(null, socket);
  });

  return socket;
}

export function createSmtpEmailSender(
  options: SMTPTransportOptions,
  transportFactory: SmtpTransportFactory = nodemailer.createTransport,
  socketConnector: SmtpSocketConnector = openSmtpSocket,
  deadlineMs = EMAIL_DELIVERY_DEADLINE_MS,
): (_message: EmailMessage) => Promise<void> {
  return async (message) => {
    let activeSocket: Socket | undefined;
    let pendingSocketCallback:
      | ((_error: Error | null, _socket?: Socket) => void)
      | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    const transport = transportFactory({
      ...options,
      getSocket: (socketOptions, callback) => {
        const connector = socketConnector;
        pendingSocketCallback = (error, socket) => {
          if (error || !socket) {
            pendingSocketCallback = undefined;
            callback(error ?? new Error("SMTP connection could not be opened."));
            return;
          }

          activeSocket = socket;
          pendingSocketCallback = undefined;
          callback(null, { connection: socket });
        };
        activeSocket = connector(
          {
            host: socketOptions.host ?? options.host ?? "",
            port: Number(socketOptions.port ?? options.port ?? 0),
          },
          (error, socket) => pendingSocketCallback?.(error, socket),
        );
      },
    });

    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        const error = new EmailDeliveryTimeoutError();
        pendingSocketCallback?.(error);
        pendingSocketCallback = undefined;
        activeSocket?.destroy();
        reject(error);
      }, deadlineMs);
    });

    const send = Promise.resolve().then(() => transport.sendMail(message));

    try {
      await Promise.race([send, deadline]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      activeSocket?.destroy();
      transport.close();
    }
  };
}

export function createEmailProviderSender(
  provider: "smtp" | "resend",
  clients: {
    resend?: ResendEmailClient;
    smtp?: SmtpEmailClient;
  },
  deadlineMs = EMAIL_DELIVERY_DEADLINE_MS,
): (_message: EmailMessage) => Promise<void> {
  if (provider === "smtp") {
    const smtpClient = clients.smtp;
    if (!smtpClient) throw new Error("SMTP email provider is unavailable.");

    return async (message) => {
      await smtpClient.sendMail(message);
    };
  }

  const resendClient = clients.resend;
  if (!resendClient) throw new Error("Resend email provider is unavailable.");

  return async (message) => {
    const controller = new AbortController();
    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        controller.abort();
        reject(new EmailDeliveryTimeoutError());
      }, deadlineMs);
    });

    const send = Promise.resolve().then(() =>
      resendClient.emails.send(message, { signal: controller.signal }),
    );
    let result: { error: unknown | null };
    try {
      result = await Promise.race([send, deadline]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }

    if (result.error) throw new Error("Resend email provider returned an error.");
  };
}

const resendClient = env.EMAIL_PROVIDER === "resend"
  ? new Resend(env.RESEND_API_KEY!)
  : undefined;

const smtpClient = env.EMAIL_PROVIDER === "smtp"
  ? {
      sendMail: createSmtpEmailSender({
        host: env.SMTP_HOST!,
        port: env.SMTP_PORT!,
        secure: env.SMTP_SECURE === "true",
        auth: {
          user: env.SMTP_USER!,
          pass: env.SMTP_PASS!,
        },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        requireTLS: env.SMTP_SECURE !== "true",
        tls: { rejectUnauthorized: true },
      }),
    }
  : undefined;

const sendWithProvider = createEmailProviderSender(env.EMAIL_PROVIDER, {
  ...(resendClient ? { resend: resendClient } : {}),
  ...(smtpClient ? { smtp: smtpClient } : {}),
});

// Tests replace this provider boundary so no test can make a real network call.
export const emailTransport = {
  send: (message: EmailMessage): Promise<void> => sendWithProvider(message),
};

async function deliverEmail(
  message: EmailMessage,
  failureLog: string,
  failureMessage: string,
  successLog: string,
): Promise<void> {
  try {
    await emailTransport.send(message);
    console.log(successLog);
  } catch (error) {
    console.error(
      failureLog,
      createEmailDiagnostic(env.EMAIL_PROVIDER, error),
    );
    throw new Error(failureMessage);
  }
}

export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<void> {
  const verificationUrl = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;

  await deliverEmail({
    from: env.EMAIL_FROM,
    to: email,
    subject: "Verify your Campus Market account",
    html: `
      <h2>Verify your Campus Market account</h2>
      <p>Click the link below to verify your email address:</p>
      <p>
        <a href="${verificationUrl}">Verify my email</a>
      </p>
      <p>This link will expire in ${env.EMAIL_VERIFICATION_TTL_HOURS} hours.</p>
      <p>If you did not create this account, you can safely ignore this email.</p>
    `,
  }, "Verification email provider returned an error.", "Verification email could not be sent.", "Verification email sent.");
}

export async function sendUniversityVerificationEmail(
  email: string,
  token: string,
): Promise<void> {
  const verificationUrl = `${env.APP_URL}/verify-university-email?token=${encodeURIComponent(token)}`;

  await deliverEmail({
    from: env.EMAIL_FROM,
    to: email,
    subject: "Verify your MUT student email",
    html: `
      <h2>Verify your MUT student email</h2>
      <p>Confirm control of your university email address to complete student verification:</p>
      <p>
        <a href="${verificationUrl}">Verify my university email</a>
      </p>
      <p>This link will expire in ${env.EMAIL_VERIFICATION_TTL_HOURS} hours.</p>
    `,
  }, "University verification email provider returned an error.", "University verification email could not be sent.", "University verification email sent.");
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<void> {
  const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

  await deliverEmail({
    from: env.EMAIL_FROM,
    to: email,
    subject: "Reset your Campus Market password",
    html: `
      <h2>Reset your Campus Market password</h2>
      <p>We received a request to reset your password.</p>
      <p>
        <a href="${resetUrl}">Reset my password</a>
      </p>
      <p>This link will expire in ${env.PASSWORD_RESET_TTL_MINUTES} minutes.</p>
      <p>If you did not request a password reset, you can safely ignore this email.</p>
    `,
  }, "Password reset email provider returned an error.", "Password reset email could not be sent.", "Password reset email sent.");
}
