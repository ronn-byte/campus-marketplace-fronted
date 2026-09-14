import { AppError } from "../../app/errors.js";

type Counter = { count: number; resetAt: number };

const counters = new Map<string, Counter>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

// This is intentionally single-instance. Multi-instance production needs a shared store.
export function enforceAuthRateLimit(key: string): void {
  const now = Date.now();
  const current = counters.get(key);
  const counter = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + WINDOW_MS }
    : current;

  counter.count += 1;
  counters.set(key, counter);

  if (counter.count > MAX_ATTEMPTS) {
    throw new AppError(429, "AUTH_RATE_LIMITED", "Too many authentication attempts. Please try again later.");
  }
}
