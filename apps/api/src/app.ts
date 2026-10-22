import { randomUUID } from 'node:crypto';
import express from 'express';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import { quoteRequestSchema, API_PREFIX } from '@tglobal/shared';
import type { Logger } from 'pino';
import type { LoanSchemeRepository } from './repositories/loan-scheme-repository.js';
import { listActiveLoanSchemes } from './services/loan-scheme-service.js';
import { createQuotes } from './services/quote-service.js';
import { AppError, NotFoundError, ValidationError } from './errors.js';
import { logger as defaultLogger } from './logger.js';

export type AppDependencies = {
  loanSchemeRepository: LoanSchemeRepository;
  goldRatePaisePerGram: bigint;
  logger?: Logger;
};

export function createApp(deps: AppDependencies) {
  const app = express();

  app.use(
    pinoHttp({
      logger: deps.logger ?? defaultLogger,
      genReqId(request, response) {
        const supplied = request.headers['x-request-id'];
        const requestId = typeof supplied === 'string' && /^[\w-]{1,128}$/.test(supplied)
          ? supplied
          : randomUUID();
        response.setHeader('x-request-id', requestId);
        return requestId;
      },
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  app.get(`${API_PREFIX}/health`, (_request, response) => {
    response.json({ ok: true });
  });

  app.get(`${API_PREFIX}/loan-schemes`, async (_request, response) => {
    response.json(await listActiveLoanSchemes(deps.loanSchemeRepository));
  });

  app.post(`${API_PREFIX}/quotes`, async (request, response) => {
    const parsed = quoteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.'),
        message: issue.message,
      }));
      throw new ValidationError('Request validation failed.', fields);
    }

    response.json(
      await createQuotes(parsed.data, deps.loanSchemeRepository, deps.goldRatePaisePerGram),
    );
  });

  app.use((_request, _response, next) => next(new NotFoundError()));

  app.use(
    (
      error: unknown,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof AppError) {
        response.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
            fields: error.fields,
          },
        });
        return;
      }

      if (error instanceof ZodError) {
        const fields = error.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          message: issue.message,
        }));
        response.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', fields },
        });
        return;
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        error.type === 'entity.parse.failed'
      ) {
        response.status(400).json({
          error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', fields: [] },
        });
        return;
      }

      request.log.error({ err: error }, 'Unhandled API error');
      response.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          fields: [],
        },
      });
    },
  );

  return app;
}
