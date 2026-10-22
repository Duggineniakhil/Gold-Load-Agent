import { randomUUID } from 'node:crypto';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { z, ZodError } from 'zod';
import {
  agentConfirmRequestSchema,
  agentMessageRequestSchema,
  idempotencyKeySchema,
  leadRequestSchema,
  planIdSchema,
  quoteRequestSchema,
  statusUpdateRequestSchema,
  API_PREFIX,
} from '@tglobal/shared';
import type { Logger } from 'pino';
import type { LeadRepository } from './repositories/lead-repository.js';
import type { LoanSchemeRepository } from './repositories/loan-scheme-repository.js';
import type { AgentService } from './services/agent-service.js';
import { listActiveLoanSchemes } from './services/loan-scheme-service.js';
import type { GoldRateService } from './services/gold-rate-service.js';
import {
  getLeadAudit,
  listLeads,
  submitLeadRequest,
  updateLeadStatus,
} from './services/lead-service.js';
import { createQuotes } from './services/quote-service.js';
import { AppError, NotFoundError, ValidationError } from './errors.js';
import { logger as defaultLogger } from './logger.js';

export type AppDependencies = {
  loanSchemeRepository: LoanSchemeRepository;
  leadRepository: LeadRepository;
  goldRate: GoldRateService;
  /** Absent when no LLM key is configured; the agent routes then answer 503. */
  agent?: AgentService | undefined;
  logger?: Logger;
};

function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    throw new ValidationError('Request validation failed.', fields);
  }
  return parsed.data;
}

function parseHeader<T extends z.ZodType>(schema: T, value: string, header: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Request validation failed.', [
      { field: header, message: parsed.error.issues[0]?.message ?? 'Invalid header.' },
    ]);
  }
  return parsed.data;
}

function requireAgent(agent: AgentService | undefined): AgentService {
  if (!agent) {
    throw new AppError(
      503,
      'AGENT_NOT_CONFIGURED',
      'Loan Assist is not configured on this server. Set LLM_API_KEY.',
    );
  }
  return agent;
}

export function createApp(deps: AppDependencies) {
  const app = express();

  app.use(
    pinoHttp({
      logger: deps.logger ?? defaultLogger,
      genReqId(request, response) {
        const supplied = request.headers['x-request-id'];
        const requestId =
          typeof supplied === 'string' && /^[\w-]{1,128}$/.test(supplied) ? supplied : randomUUID();
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
    const input = parseOrThrow(quoteRequestSchema, request.body);
    const { ratePaisePerGram } = await deps.goldRate.current();
    response.json(await createQuotes(input, deps.loanSchemeRepository, ratePaisePerGram));
  });

  app.post(`${API_PREFIX}/leads`, async (request, response) => {
    const input = parseOrThrow(leadRequestSchema, request.body);
    const key = request.get('Idempotency-Key');
    const idempotencyKey =
      key === undefined ? undefined : parseHeader(idempotencyKeySchema, key, 'Idempotency-Key');
    const { ratePaisePerGram } = await deps.goldRate.current();
    const { response: body, replayed } = await submitLeadRequest(
      input,
      deps.leadRepository,
      ratePaisePerGram,
      idempotencyKey ? { key: idempotencyKey, body: request.body } : undefined,
    );
    if (replayed) response.setHeader('Idempotency-Replayed', 'true');
    response.status(201).json(body);
  });

  app.get(`${API_PREFIX}/leads`, async (request, response) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().min(1).optional(),
      planId: planIdSchema.optional(),
    });
    const query = parseOrThrow(querySchema, request.query);
    response.json(await listLeads(deps.leadRepository, query));
  });

  app.patch(`${API_PREFIX}/leads/:applicationId/status`, async (request, response) => {
    const update = parseOrThrow(statusUpdateRequestSchema, request.body);
    response.json(
      await updateLeadStatus(request.params.applicationId, update, deps.leadRepository),
    );
  });

  app.get(`${API_PREFIX}/leads/:applicationId/audit`, async (request, response) => {
    response.json(await getLeadAudit(request.params.applicationId, deps.leadRepository));
  });

  app.get(`${API_PREFIX}/gold-rate`, async (_request, response) => {
    const rate = await deps.goldRate.current();
    response.json({
      ratePerGram24k: Number(rate.ratePaisePerGram / 100n),
      ratePaisePerGram24k: Number(rate.ratePaisePerGram),
      currency: 'INR',
      source: rate.source,
      asOf: rate.asOf.toISOString(),
      cachedUntil: rate.cachedUntil.toISOString(),
    });
  });

  app.post(`${API_PREFIX}/agent/messages`, async (request, response) => {
    const input = parseOrThrow(agentMessageRequestSchema, request.body);
    response.json(await requireAgent(deps.agent).sendMessage(input));
  });

  app.post(`${API_PREFIX}/agent/sessions/:sessionId/confirm`, async (request, response) => {
    const { confirm } = parseOrThrow(agentConfirmRequestSchema, request.body);
    response.json(await requireAgent(deps.agent).confirm(request.params.sessionId, confirm));
  });

  app.use((_request, _response, next) => next(new NotFoundError()));

  app.use(
    (
      error: unknown,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      if (error instanceof AppError) {
        if (error.statusCode >= 500) request.log.error({ err: error }, 'API dependency error');
        response.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
            fields: error.fields,
            ...error.extra,
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
