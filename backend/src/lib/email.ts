import nodemailer, { type Transporter } from "nodemailer";
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
    send(_message: EmailMessage): Promise<{ error: unknown | null }>;
  };
};

type SmtpEmailClient = Pick<Transporter, "sendMail">;

export function createEmailProviderSender(
  provider: "smtp" | "resend",
  clients: {
    resend?: ResendEmailClient;
    smtp?: SmtpEmailClient;
  },
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
    const result = await resendClient.emails.send(message);
    if (result.error) throw new Error("Resend email provider returned an error.");
  };
}

const resendClient = env.EMAIL_PROVIDER === "resend"
  ? new Resend(env.RESEND_API_KEY!)
  : undefined;

const smtpClient = env.EMAIL_PROVIDER === "smtp"
  ? nodemailer.createTransport({
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
    })
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
  } catch {
    // Provider errors can contain recipient or account details; log only a generic event.
    console.error(failureLog);
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
