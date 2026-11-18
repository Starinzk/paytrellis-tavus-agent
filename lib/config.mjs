// Settings that differ between running locally and a hosted demo.
// Everything has a safe local default; a host sets these as environment variables.
import { timingSafeEqual } from "node:crypto";

export function readConfig(env = process.env) {
  const number = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
  return {
    // If set, starting a call needs this code (shared with reviewers), so the
    // public link can't be used to run up Tavus minutes.
    accessCode: env.DEMO_ACCESS_CODE?.trim() || null,
    // Calls allowed per rolling hour across everyone. Unlimited locally.
    maxCallsPerHour: number(env.MAX_CALLS_PER_HOUR, Infinity),
    // Hard cap on each call's length, in seconds.
    maxCallSeconds: number(env.MAX_CALL_SECONDS, 600),
  };
}

export function codeMatches(expected, given) {
  if (!expected) return true;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(given ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Rolling one-hour window of call start times.
export function callLimiter(maxPerHour, now = () => Date.now()) {
  const starts = [];
  return {
    tryStart() {
      const cutoff = now() - 3_600_000;
      while (starts.length && starts[0] < cutoff) starts.shift();
      if (starts.length >= maxPerHour) return false;
      starts.push(now());
      return true;
    },
  };
}
