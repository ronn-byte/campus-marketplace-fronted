import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = new Resend(env.RESEND_API_KEY);

export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<void> {
  const verificationUrl = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;

  const { data, error } = await resend.emails.send({
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
  });

  if (error) {
    console.error("Verification email failed:", error);
    throw new Error("Verification email could not be sent.");
  }

  console.log("Verification email sent:", data?.id);
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<void> {
  const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

  const { data, error } = await resend.emails.send({
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
  });

  if (error) {
    console.error("Password reset email failed:", error);
    throw new Error("Password reset email could not be sent.");
  }

  console.log("Password reset email sent:", data?.id);
}