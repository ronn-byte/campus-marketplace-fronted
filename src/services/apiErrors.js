const safeCodeMessages = {
  INVALID_CREDENTIALS: "That email or password wasn't recognized. Check your details or reset your password.",
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  AUTH_RATE_LIMITED: "Too many attempts were made. Wait a little while, then try again.",
  VALIDATION_ERROR: "Please check the form fields and try again.",
  EMAIL_ALREADY_EXISTS: "An account already uses this email. Log in or reset the password instead.",
  INVALID_STUDENT_EMAIL: "The registration number does not match the expected MUT student email. Check your details and try again.",
  INVALID_VERIFICATION_TOKEN: "This verification link is invalid or expired. Request a new link and try again.",
  INVALID_RESET_TOKEN: "This password reset link is invalid or expired. Request a new reset link and try again.",
  INVALID_IMAGE_TYPE: "Choose a JPEG, PNG, or WebP image.",
  INVALID_IMAGE_CONTENT: "This file could not be read as a supported image. Choose another image.",
  INVALID_IMAGE_SIZE: "One of the images is too large. Each image must be no larger than 5 MB.",
  PAYLOAD_TOO_LARGE: "The selected files are too large to upload together. Choose fewer or smaller images.",
  UPLOAD_RETRY_MISMATCH: "This retry does not match the saved image upload. Reopen the draft and select the original images again.",
  VERIFICATION_STORAGE_UNAVAILABLE: "Student verification is temporarily unavailable. Try again later.",
  INTERNAL_ERROR: "Something went wrong on our side. Your information has been kept; check its status before retrying.",
};

export function classifyApiError(error, context = "request") {
  const status = error?.response?.status;
  const responseCode = error?.response?.data?.error?.code;
  const code = typeof responseCode === "string" ? responseCode : "";

  if (!error?.response) {
    if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
      return {
        kind: "timeout",
        title: "We couldn't confirm the result",
        message: "The request took too long to finish. Your information may have been received. Check the current status before trying again.",
        actionLabel: context === "register" || context === "reset-password" || context === "verify-email"
          ? "Check sign-in"
          : "Review and try again",
        actionTo: ["register", "reset-password", "verify-email"].includes(context) ? "/login" : undefined,
      };
    }
    if (error?.isAxiosError || error?.request || error?.config || error?.code === "ERR_NETWORK") {
      return {
        kind: "network",
        title: "Connection problem",
        message: "We couldn't reach MUT Market. Check your connection and try again. Your form details are still here.",
        actionLabel: "Try again",
      };
    }
    return { kind: "request", title: "We couldn't complete that request", message: "Check the current status and try again." };
  }

  if (code === "INVALID_CREDENTIALS" || (status === 401 && context === "login")) {
    return { kind: "authentication", title: "Couldn't sign you in", message: safeCodeMessages.INVALID_CREDENTIALS, actionLabel: "Reset password", actionTo: "/forgot-password" };
  }
  if (status === 401 || code === "UNAUTHENTICATED") {
    return { kind: "authentication", title: "Sign in again", message: safeCodeMessages.UNAUTHENTICATED, actionLabel: "Go to login", actionTo: "/login" };
  }
  if (code === "VALIDATION_ERROR" || (status === 422 && !Object.prototype.hasOwnProperty.call(safeCodeMessages, code))) {
    return { kind: "validation", title: "Check your details", message: safeCodeMessages.VALIDATION_ERROR };
  }
  if (status === 429 || code === "AUTH_RATE_LIMITED") {
    return { kind: "rate-limit", title: "Please wait before trying again", message: safeCodeMessages.AUTH_RATE_LIMITED };
  }
  if (Object.prototype.hasOwnProperty.call(safeCodeMessages, code)) {
    const recovery = code === "EMAIL_ALREADY_EXISTS"
      ? { label: "Go to login", to: "/login" }
      : code === "INVALID_RESET_TOKEN"
        ? { label: "Request a new reset link", to: "/forgot-password" }
        : code === "INVALID_VERIFICATION_TOKEN"
          ? { label: "Request a new link", to: "/settings" }
          : code === "INVALID_STUDENT_EMAIL"
            ? { label: "Review verification", to: "/verify-student" }
            : undefined;
    const isUploadError = code.startsWith("INVALID_IMAGE") || code === "PAYLOAD_TOO_LARGE" || code === "UPLOAD_RETRY_MISMATCH";
    return {
      kind: isUploadError ? "upload" : "request",
      title: isUploadError ? "Image upload needs attention" : "We couldn't complete that request",
      message: safeCodeMessages[code],
      actionLabel: recovery?.label,
      actionTo: recovery?.to,
    };
  }
  if (status === 503) {
    return { kind: "unavailable", title: "Temporarily unavailable", message: "This service is temporarily unavailable. Wait a little while and try again." };
  }
  if (status >= 500) {
    return { kind: "server", title: "We couldn't complete that request", message: "Something went wrong on our side. Check the current status before retrying." };
  }
  return { kind: "request", title: "We couldn't complete that request", message: "Check your details and try again." };
}

export function getApiErrorMessage(error, context = "request") {
  return classifyApiError(error, context).message;
}
