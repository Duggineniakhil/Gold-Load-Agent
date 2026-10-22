import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from './errors.js';
import { createRateLimiter } from './rate-limit.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Guards the admin endpoints with the `X-Admin-Passcode` header when ADMIN_PASSCODE is set.
 * The comparison is constant-time, and after 10 wrong passcodes from one IP in 15 minutes
 * further attempts get 429. With no passcode configured, the endpoints stay open.
 */
export function createAdminGuard(passcode: string | undefined): RequestHandler {
  if (!passcode) return (_request, _response, next) => next();
  const expected = digest(passcode);
  const limitFailures = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });

  return (request, response, next) => {
    const supplied = request.get('X-Admin-Passcode');
    if (supplied !== undefined && timingSafeEqual(digest(supplied), expected)) {
      next();
      return;
    }
    limitFailures(request, response, (limited?: unknown) =>
      next(limited ?? new AppError(401, 'ADMIN_AUTH_REQUIRED', 'Enter the admin passcode.')),
    );
  };
}
