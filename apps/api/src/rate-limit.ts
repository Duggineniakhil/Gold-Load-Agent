import type { RequestHandler } from 'express';
import { AppError } from './errors.js';

export type RateLimitOptions = { max: number; windowMs: number; now?: () => number };

/**
 * Fixed-window limit per client IP, kept in memory: right for a single API instance.
 * A shared store (Redis) would be needed once the API runs as several processes.
 * Over the limit, the request fails with 429 RATE_LIMITED and a Retry-After header.
 */
export function createRateLimiter({
  max,
  windowMs,
  now = () => Date.now(),
}: RateLimitOptions): RequestHandler {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;

  return (request, response, next) => {
    const time = now();
    if (time >= nextSweep) {
      for (const [key, window] of windows) if (window.resetAt <= time) windows.delete(key);
      nextSweep = time + windowMs;
    }

    const key = request.ip ?? 'unknown';
    const window = windows.get(key);
    if (!window || window.resetAt <= time) {
      windows.set(key, { count: 1, resetAt: time + windowMs });
      next();
      return;
    }
    if (window.count >= max) {
      response.setHeader('Retry-After', String(Math.ceil((window.resetAt - time) / 1000)));
      next(
        new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'),
      );
      return;
    }
    window.count += 1;
    next();
  };
}
